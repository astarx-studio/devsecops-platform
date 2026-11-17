import pg from "pg";

// Run state. One row per (project, MR, head SHA): it dedupes webhook retries,
// lets a newer push supersede an older queued one, and records the outcome.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS review_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    bigint  NOT NULL,
  project_path  text    NOT NULL,
  mr_iid        integer NOT NULL,
  head_sha      text    NOT NULL,
  target_branch text,
  status        text    NOT NULL,
  reason        text,
  attempts      integer NOT NULL DEFAULT 0,
  job           jsonb   NOT NULL,
  decision      text,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, mr_iid, head_sha)
);
CREATE INDEX IF NOT EXISTS review_run_mr ON review_run (project_id, mr_iid, created_at DESC);
CREATE INDEX IF NOT EXISTS review_run_status ON review_run (status, created_at);
-- Related repositories: the same head SHA is reviewed again when a paired
-- head moves, so the paired heads are part of the key.
ALTER TABLE review_run ADD COLUMN IF NOT EXISTS context_key text NOT NULL DEFAULT '';
ALTER TABLE review_run ADD COLUMN IF NOT EXISTS source_branch text;
ALTER TABLE review_run DROP CONSTRAINT IF EXISTS review_run_project_id_mr_iid_head_sha_key;
CREATE UNIQUE INDEX IF NOT EXISTS review_run_key ON review_run (project_id, mr_iid, head_sha, context_key);
CREATE INDEX IF NOT EXISTS review_run_branch ON review_run (source_branch, created_at DESC);
`;

// Statuses a redelivered webhook may re-open.
const REOPENABLE = ["failed", "skipped"];

// A finished run whose job never received a base SHA is the "base and head
// are the same" false positive: GitLab had not prepared diff_refs yet. A later
// event that does have a base must review that head.
export function shouldReopen(existing, job) {
  if (!existing) return false;
  if (REOPENABLE.includes(existing.status)) return true;
  const prevBase = existing.job?.base_sha;
  return (
    existing.status === "done" &&
    !prevBase &&
    Boolean(job?.base_sha) &&
    job.base_sha !== job.head_sha
  );
}
export const LOCK_KEY = 7411001;

export class Db {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async migrate() {
    await this.pool.query(SCHEMA);
  }

  async close() {
    await this.pool.end();
  }

  // Returns { run, created, reopened }.
  async upsertQueued(job, status, reason = null) {
    const key = job.context_key ?? "";
    const { rows } = await this.pool.query(
      `INSERT INTO review_run (project_id, project_path, mr_iid, head_sha, context_key, source_branch, target_branch, status, reason, job)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (project_id, mr_iid, head_sha, context_key) DO NOTHING
       RETURNING *`,
      [
        job.project_id,
        job.project_path,
        job.mr_iid,
        job.head_sha,
        key,
        job.source_branch,
        job.target_branch,
        status,
        reason,
        job,
      ],
    );
    if (rows[0]) return { run: rows[0], created: true };
    const existing = await this.get(
      job.project_id,
      job.mr_iid,
      job.head_sha,
      key,
    );
    if (shouldReopen(existing, job)) {
      const { rows: r2 } = await this.pool.query(
        `UPDATE review_run SET status=$2, reason=$3, job=$4, attempts=0, updated_at=now(), created_at=now() WHERE id=$1 RETURNING *`,
        [existing.id, status, reason, job],
      );
      return { run: r2[0], created: false, reopened: true };
    }
    return { run: existing, created: false };
  }

  async get(projectId, mrIid, headSha, contextKey = "") {
    const { rows } = await this.pool.query(
      "SELECT * FROM review_run WHERE project_id=$1 AND mr_iid=$2 AND head_sha=$3 AND context_key=$4",
      [projectId, mrIid, headSha, contextKey],
    );
    return rows[0] ?? null;
  }

  // The paired MR's own item verdicts (before merging with its pair) from its
  // latest finished review at that head, or null.
  async latestOwnItems(projectId, mrIid, headSha) {
    const { rows } = await this.pool.query(
      `SELECT result->'review'->'ownItems' AS own FROM review_run
       WHERE project_id=$1 AND mr_iid=$2 AND head_sha=$3 AND status='done' AND result->'review' ? 'ownItems'
       ORDER BY updated_at DESC LIMIT 1`,
      [projectId, mrIid, headSha],
    );
    return rows[0]?.own ?? null;
  }

  // Runs of one MR created in the last hour (any head), for the circuit breaker.
  async runsLastHour(projectId, mrIid) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM review_run WHERE project_id=$1 AND mr_iid=$2 AND status NOT IN ('skipped') AND created_at > now() - interval '1 hour'`,
      [projectId, mrIid],
    );
    return rows[0].n;
  }

  async countRuns(projectId, mrIid, headSha, logicVersion = "") {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM review_run WHERE project_id=$1 AND mr_iid=$2 AND head_sha=$3 AND status NOT IN ('skipped')
         AND coalesce(job->>'logic_version','') = $4`,
      [projectId, mrIid, headSha, logicVersion],
    );
    return rows[0].n;
  }

  // The latest job of an MR in another project, for re-reviewing it when its
  // paired MR moves. Only MRs that were reviewed before can be re-reviewed.
  async latestJob(projectId, mrIid) {
    const { rows } = await this.pool.query(
      `SELECT job FROM review_run WHERE project_id=$1 AND mr_iid=$2 AND status IN ('done','failed','queued','running') ORDER BY created_at DESC LIMIT 1`,
      [projectId, mrIid],
    );
    return rows[0]?.job ?? null;
  }

  async byId(id) {
    const { rows } = await this.pool.query(
      "SELECT * FROM review_run WHERE id=$1",
      [id],
    );
    return rows[0] ?? null;
  }

  async setStatus(id, status, fields = {}) {
    const { rows } = await this.pool.query(
      `UPDATE review_run SET status=$2, reason=COALESCE($3, reason), decision=COALESCE($4, decision),
         result=COALESCE($5, result), attempts=attempts + $6, updated_at=now() WHERE id=$1 RETURNING *`,
      [
        id,
        status,
        fields.reason ?? null,
        fields.decision ?? null,
        fields.result ?? null,
        fields.incAttempts ? 1 : 0,
      ],
    );
    return rows[0];
  }

  // A newer push on the same MR that is queued, running or reviewed.
  async newerRun(run) {
    const { rows } = await this.pool.query(
      `SELECT id, head_sha, status FROM review_run
       WHERE project_id=$1 AND mr_iid=$2 AND id<>$3 AND created_at > $4 AND status IN ('queued','running','done')
       ORDER BY created_at DESC LIMIT 1`,
      [run.project_id, run.mr_iid, run.id, run.created_at],
    );
    return rows[0] ?? null;
  }

  // Rows that should be in the queue. Re-published on start so a row whose
  // publish was lost (crash, broker error) still gets reviewed.
  async queuedRuns() {
    const { rows } = await this.pool.query(
      `SELECT id FROM review_run WHERE status='queued' ORDER BY created_at`,
    );
    return rows;
  }

  async queuePosition(run) {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM review_run WHERE (status='queued' AND created_at < $1) OR status='running'`,
      [run.created_at],
    );
    return rows[0].n + 1;
  }

  // Blocks until no other worker holds the review lock. Returns a release fn.
  async lockReview() {
    const client = await this.pool.connect();
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    return async () => {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      } finally {
        client.release();
      }
    };
  }
}
