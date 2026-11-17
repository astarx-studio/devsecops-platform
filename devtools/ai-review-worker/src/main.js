import http from 'node:http';
import crypto from 'node:crypto';
import { ConfigStore } from './config.js';
import { Db } from './db.js';
import { connectQueue, JOBS, DLQ } from './queue.js';
import { createArtifacts } from './store.js';
import { createQestorLookup } from './qestor.js';
import { intake, processDelivery } from './worker.js';
import { createGitlab } from './gitlab.js';

const env = process.env;
const log = {
  info: (m) => console.log(`${new Date().toISOString()} INFO ${m}`),
  error: (m) => console.error(`${new Date().toISOString()} ERROR ${m}`),
};

for (const k of ['AI_REVIEW_PG_URL', 'AI_REVIEW_AMQP_URL', 'AI_REVIEW_INTAKE_TOKEN', 'GITLAB_URL', 'AI_REVIEW_GITLAB_TOKEN']) {
  if (!env[k]) {
    log.error(`${k} is not set`);
    process.exit(1);
  }
}
env.AI_REVIEW_REPOS_DIR ??= '/repos';

const configStore = new ConfigStore(env.AI_REVIEW_CONFIG ?? '/config/review.yaml', log);
configStore.load();
const db = new Db(env.AI_REVIEW_PG_URL);
await db.migrate();
const q = await connectQueue(env.AI_REVIEW_AMQP_URL, log);
const gitlab = createGitlab({ baseUrl: env.GITLAB_URL, token: env.AI_REVIEW_GITLAB_TOKEN });
const deps = { artifacts: createArtifacts(env, log), qestorLookup: createQestorLookup(env), log, gitlab };

const tokenOk = (got) => {
  const a = Buffer.from(String(got ?? ''));
  const b = Buffer.from(env.AI_REVIEW_INTAKE_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Intake is reachable from n8n on devops-network only; no host port, no Traefik.
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/jobs') return send(res, 404, { error: 'not found' });
  if (!tokenOk((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return send(res, 401, { error: 'unauthorized' });
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) return send(res, 413, { error: 'body too large' });
  }
  try {
    const out = await intake(JSON.parse(raw), { configStore, db, publish: q.publish, gitlab, log });
    log.info(`intake: ${out.status} ${out.run_id ?? ''} ${out.reason ?? ''}${out.paired?.length ? ` paired=${out.paired.map((p) => `${p.path}${p.mr_iid ? `!${p.mr_iid}` : `@${p.ref}`}`).join(',')}` : ''}${out.rereviews?.length ? ` rereviews=${out.rereviews.map((r) => `${r.project_path}!${r.mr_iid}:${r.status}`).join(',')}` : ''}`);
    send(res, 200, out);
  } catch (err) {
    log.error(`intake: ${err.message}`);
    send(res, 400, { error: err.message });
  }
});
server.listen(Number(env.AI_REVIEW_PORT ?? 8791), () => log.info(`intake listening on ${env.AI_REVIEW_PORT ?? 8791}`));

await q.sub.consume(JOBS, async (msg) => {
  if (!msg) return;
  let payload;
  try {
    payload = JSON.parse(msg.content.toString());
  } catch {
    q.sub.ack(msg);
    return;
  }
  try {
    const r = await processDelivery(payload, { redelivered: msg.fields.redelivered, configStore, db, publish: q.publish, env, deps, log });
    log.info(`job ${payload.run_id}: ${r.outcome}`);
    q.sub.ack(msg);
  } catch (err) {
    // Infrastructure error (DB/queue). Back off, then republish with a
    // delivery counter; past max_deliveries the message goes to the DLQ, so a
    // poison message can't cycle forever.
    const deliveries = Number(msg.properties.headers?.['x-deliveries'] ?? 0) + 1;
    let limit = 10;
    try {
      limit = configStore.load().defaults.runtime.max_deliveries;
    } catch {}
    log.error(`job ${payload.run_id}: ${err.message}; delivery ${deliveries}/${limit}`);
    setTimeout(async () => {
      try {
        if (deliveries >= limit) await q.publish(DLQ, { ...payload, error: err.message, deliveries });
        else await q.publish(JOBS, payload, { 'x-deliveries': deliveries });
        q.sub.ack(msg);
      } catch (e) {
        log.error(`job ${payload.run_id}: could not republish (${e.message}); requeueing`);
        q.sub.nack(msg, false, true);
      }
    }, Math.min(60000, 5000 * deliveries));
  }
});
log.info('consuming ai-review.jobs with prefetch 1');

// Recovery: re-publish queued rows. A duplicate delivery is harmless, because
// processDelivery skips rows that are no longer queued.
for (const { id } of await db.queuedRuns()) {
  await q.publish(JOBS, { run_id: id });
  log.info(`recovery: re-queued ${id}`);
}

const shutdown = async () => {
  server.close();
  q.conn.stopping = true;
  await q.conn.close().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
