import { Client } from 'minio';

// Audit artifacts per run in MinIO: diff, every model round, final result.
// Without MinIO settings this is a no-op, so local tests and dev need nothing.
export function createArtifacts(env, log = console) {
  if (!env.AI_REVIEW_MINIO_ENDPOINT || !env.AI_REVIEW_MINIO_ACCESS_KEY) {
    return { put: async () => {}, enabled: false };
  }
  const u = new URL(env.AI_REVIEW_MINIO_ENDPOINT);
  const client = new Client({
    endPoint: u.hostname,
    port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
    useSSL: u.protocol === 'https:',
    accessKey: env.AI_REVIEW_MINIO_ACCESS_KEY,
    secretKey: env.AI_REVIEW_MINIO_SECRET_KEY,
  });
  const bucket = env.AI_REVIEW_MINIO_BUCKET || 'ai-review';
  return {
    enabled: true,
    key: (runId, job, name) => `runs/${job.project_id}/${job.mr_iid}/${String(job.head_sha).slice(0, 12)}/${runId}/${name}`,
    async put(runId, job, name, body) {
      try {
        await client.putObject(bucket, this.key(runId, job, name), Buffer.from(String(body)), undefined, { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'text/plain' });
      } catch (err) {
        log.error(`artifacts: put ${name} failed: ${err.message}`);
      }
    },
  };
}
