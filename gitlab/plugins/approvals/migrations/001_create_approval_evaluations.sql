-- Audit trail of approval-rule evaluations. Lives in the plugin database
-- (dsoaas_gitlab_plugins), never in gitlabhq_production. One row per distinct
-- outcome per merge request; repeated identical evaluations are deduplicated.
CREATE TABLE IF NOT EXISTS dsoaas_approval_evaluations (
  id                bigserial   PRIMARY KEY,
  project_id        bigint      NOT NULL,
  merge_request_id  bigint      NOT NULL,
  merge_request_iid integer     NOT NULL,
  head_sha          text,
  state             text        NOT NULL,
  rules             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  digest            text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merge_request_id, digest)
);

CREATE INDEX IF NOT EXISTS index_dsoaas_approval_evaluations_on_project_mr
  ON dsoaas_approval_evaluations (project_id, merge_request_iid, created_at DESC);
