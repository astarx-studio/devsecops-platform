-- Approval rules managed from the platform console (one row per GitLab project).
-- Written by the platform api, read by the approvals plugin. A project with a row
-- here ignores `.gitlab/approvals.yml`; deleting the row falls back to the file.
-- `config` has the same shape as the YAML file (rules, author_can_approve,
-- committers_can_approve, reset_on_push).
CREATE TABLE IF NOT EXISTS dsoaas_approval_rule_sets (
  project_id bigint      PRIMARY KEY,
  config     jsonb       NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
