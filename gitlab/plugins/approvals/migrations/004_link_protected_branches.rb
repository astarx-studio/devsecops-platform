# frozen_string_literal: true

# Links approval rules to branch rules (protected branches) by ID, as GitLab EE
# does, so a rule follows its branch rule when that is renamed in
# Settings > Repository > Branch rules.
#
# protected_branches maps protected branch ID => name at last save. The name is
# a fallback: if the branch rule is deleted, the approval rule keeps applying to
# that name instead of silently widening to every branch.
#
# Existing branch patterns that equal one of the project's protected branches
# become links; other patterns (release/*, unprotected names) stay as patterns.
lambda do |conn|
  conn.exec(<<~SQL)
    ALTER TABLE dsoaas_approval_rules
      ADD COLUMN IF NOT EXISTS protected_branches jsonb NOT NULL DEFAULT '{}'::jsonb
  SQL

  decoder = PG::TextDecoder::Array.new
  encoder = PG::TextEncoder::Array.new
  rows = conn.exec(<<~SQL).to_a
    SELECT id, project_id, branches::text AS branches
      FROM dsoaas_approval_rules
     WHERE cardinality(branches) > 0 AND protected_branches = '{}'::jsonb
  SQL

  rows.each do |row|
    branches = decoder.decode(row['branches'])
    found = ::ProtectedBranch.where(project_id: row['project_id'].to_i, name: branches).pluck(:id, :name)
    next if found.empty?

    links = found.to_h { |id, name| [id.to_s, name] }
    conn.exec_params(<<~SQL, [encoder.encode(branches - links.values), links.to_json, row['id']])
      UPDATE dsoaas_approval_rules SET branches = $1::text[], protected_branches = $2::jsonb WHERE id = $3
    SQL
  end
end
