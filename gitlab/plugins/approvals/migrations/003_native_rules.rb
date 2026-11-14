# frozen_string_literal: true

# Native (GitLab-UI managed) approval rules, modelled on GitLab EE's
# approval_project_rules, stored in the plugin database.
#
# Users and groups are referenced by ID, as in EE, so renames don't break rules.
# Console-era rule sets (dsoaas_approval_rule_sets, usernames/group paths) are
# copied over; approvers that no longer resolve are dropped and logged. The old
# table is left in place, read-only, for one release.
lambda do |conn|
  conn.exec(<<~SQL)
    CREATE TABLE IF NOT EXISTS dsoaas_approval_rules (
      id                                bigserial   PRIMARY KEY,
      project_id                        bigint      NOT NULL,
      name                              text        NOT NULL,
      approvals_required                integer     NOT NULL DEFAULT 0,
      require_all                       boolean     NOT NULL DEFAULT false,
      user_ids                          bigint[]    NOT NULL DEFAULT '{}',
      group_ids                         bigint[]    NOT NULL DEFAULT '{}',
      branches                          text[]      NOT NULL DEFAULT '{}',
      applies_to_all_protected_branches boolean     NOT NULL DEFAULT false,
      paths                             text[]      NOT NULL DEFAULT '{}',
      created_at                        timestamptz NOT NULL DEFAULT now(),
      updated_at                        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT dsoaas_approval_rules_name_unique UNIQUE (project_id, name),
      CONSTRAINT dsoaas_approval_rules_required_range CHECK (approvals_required BETWEEN 0 AND 100)
    );
    CREATE INDEX IF NOT EXISTS index_dsoaas_approval_rules_on_project
      ON dsoaas_approval_rules (project_id, id);

    CREATE TABLE IF NOT EXISTS dsoaas_approval_project_settings (
      project_id                                 bigint      PRIMARY KEY,
      merge_requests_author_approval             boolean     NOT NULL DEFAULT false,
      merge_requests_disable_committers_approval boolean     NOT NULL DEFAULT false,
      reset_approvals_on_push                    boolean     NOT NULL DEFAULT true,
      updated_by_id                              bigint,
      updated_at                                 timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS dsoaas_approval_rule_events (
      id         bigserial   PRIMARY KEY,
      project_id bigint      NOT NULL,
      user_id    bigint,
      action     text        NOT NULL,
      rule_id    bigint,
      snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS index_dsoaas_approval_rule_events_on_project
      ON dsoaas_approval_rule_events (project_id, created_at DESC);
  SQL

  legacy = conn.exec("SELECT to_regclass('dsoaas_approval_rule_sets') IS NOT NULL AS present").getvalue(0, 0) == 't'
  next unless legacy

  conn.exec('SELECT project_id, config::text AS config FROM dsoaas_approval_rule_sets').each do |row|
    project_id = row['project_id'].to_i
    config = JSON.parse(row['config']) rescue {} # rubocop:disable Style/RescueModifier
    next if conn.exec_params('SELECT 1 FROM dsoaas_approval_rules WHERE project_id = $1 LIMIT 1', [project_id]).ntuples.positive?

    Array(config['rules']).each do |rule|
      approvers = rule['approvers'] || {}
      usernames = Array(approvers['users'])
      paths = Array(approvers['groups'])
      user_ids = ::User.where(username: usernames).pluck(:id)
      group_ids = paths.filter_map { |p| ::Group.find_by_full_path(p)&.id }
      dropped = (usernames - ::User.where(id: user_ids).pluck(:username)) +
        (paths - ::Group.where(id: group_ids).map(&:full_path))
      Rails.logger.warn("dsoaas approvals migration: project #{project_id} rule #{rule['name']} dropped #{dropped}") if dropped.any?

      conn.exec_params(<<~SQL, [
        INSERT INTO dsoaas_approval_rules (project_id, name, approvals_required, user_ids, group_ids, paths)
        VALUES ($1, $2, $3, $4::bigint[], $5::bigint[], $6::text[])
        ON CONFLICT (project_id, name) DO NOTHING
      SQL
        project_id, rule['name'].to_s, rule['required'].to_i.clamp(0, 100),
        PG::TextEncoder::Array.new.encode(user_ids), PG::TextEncoder::Array.new.encode(group_ids),
        PG::TextEncoder::Array.new.encode(Array(rule['paths']).map(&:to_s))
      ])
    end

    conn.exec_params(<<~SQL, [
      INSERT INTO dsoaas_approval_project_settings
        (project_id, merge_requests_author_approval, merge_requests_disable_committers_approval, reset_approvals_on_push)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id) DO NOTHING
    SQL
      project_id, config['author_can_approve'] == true,
      config['committers_can_approve'] == false, config['reset_on_push'] != false
    ])
  end
end
