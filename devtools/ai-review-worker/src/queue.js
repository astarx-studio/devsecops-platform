import amqp from 'amqplib';

export const JOBS = 'ai-review.jobs';
export const RESULTS = 'ai-review.results';
export const DLQ = 'ai-review.dlq';

// Durable queues and persistent messages, so nothing is lost on restart.
export async function connectQueue(url, log = console) {
  const conn = await amqp.connect(url);
  // A dead connection or channel can't recover in place. Exit and let Docker
  // restart the worker; queued rows are re-published on start.
  const fatal = (what) => (err) => {
    if (conn.stopping) return;
    log.error(`amqp ${what} closed${err ? `: ${err.message}` : ''}; exiting for restart`);
    process.exit(1);
  };
  conn.on('error', (err) => log.error(`amqp: ${err.message}`));
  conn.on('close', fatal('connection'));
  const pub = await conn.createConfirmChannel();
  const sub = await conn.createChannel();
  pub.on('close', fatal('publish channel'));
  sub.on('close', fatal('consume channel'));
  for (const ch of [pub, sub]) {
    await ch.assertQueue(JOBS, { durable: true });
    await ch.assertQueue(RESULTS, { durable: true });
    await ch.assertQueue(DLQ, { durable: true });
  }
  // One review in flight: the next job is not delivered until this one is acked.
  await sub.prefetch(1);
  const publish = (queue, msg, headers = {}) =>
    new Promise((resolve, reject) => {
      pub.sendToQueue(queue, Buffer.from(JSON.stringify(msg)), { persistent: true, contentType: 'application/json', headers }, (err) => (err ? reject(err) : resolve()));
    });
  return { conn, pub, sub, publish };
}
