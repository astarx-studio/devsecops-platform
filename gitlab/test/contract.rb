# frozen_string_literal: true

# Contract tests: does this GitLab build still offer every seam the DSOaaS
# plugins rely on, with the shape they expect? Read-only and safe anywhere,
# including production:
#
#   gitlab-rails runner /opt/dsoaas/test/contract.rb
#
# Exits 1 on any failure.

failures = []
passes = 0
check = lambda do |label, &blk|
  outcome = begin
    blk.call
  rescue StandardError, ScriptError => e
    "raised #{e.class}: #{e.message}"
  end
  if outcome == true
    passes += 1
    puts "  ok    #{label}"
  else
    detail = outcome.is_a?(String) ? " (#{outcome})" : " (got #{outcome.inspect})"
    failures << "#{label}#{detail}"
    puts "  FAIL  #{label}#{detail}"
  end
end

def param_names(owner, meth)
  owner.instance_method(meth).parameters.map(&:last)
end

puts "DSOaaS plugin contract - GitLab #{Gitlab::VERSION} (#{Gitlab.ee? ? 'EE' : 'CE'})"

puts 'loader'
check.call('loader defined') { defined?(Dsoaas::Plugins) == 'constant' }
check.call('approvals plugin installed') do
  status = Dsoaas::Plugins.statuses['approvals']
  puts "        status: #{status&.to_h.inspect}"
  status&.state == :installed
end

puts 'mergeability seam'
check_class = 'Dsoaas::Approvals::CheckApprovalRulesService'
check.call('check registered exactly once') do
  MergeRequest.mergeable_state_checks.count { |c| c.name == check_class } == 1
end
check.call('check in all_mergeability_checks') { MergeRequest.all_mergeability_checks.any? { |c| c.name == check_class } }
check.call('stock CE checks preserved') do
  %w[CheckOpenStatusService CheckDraftStatusService CheckCiStatusService CheckDiscussionsStatusService].all? do |n|
    MergeRequest.mergeable_state_checks.include?("MergeRequests::Mergeability::#{n}".constantize)
  end
end
check.call('not_approved identifier unique') do
  MergeRequest.all_mergeability_checks.count { |c| c.identifier.to_s == 'not_approved' } == 1
end
check.call('CheckBaseService(merge_request:, params:)') do
  param_names(MergeRequests::Mergeability::CheckBaseService, :initialize) == %i[merge_request params]
end
check.call('CheckBaseService result helpers') do
  %i[success failure inactive].all? { |m| MergeRequests::Mergeability::CheckBaseService.private_method_defined?(m) }
end
check.call('CheckResult statuses') do
  r = Gitlab::MergeRequests::Mergeability::CheckResult
  %i[success failed inactive].all? { |m| r.respond_to?(m) }
end
check.call('auto-merge still passes skip_approved_check') do
  File.read(Rails.root.join('app/models/merge_request.rb')).include?('skip_approved_check: merge_when_checks_pass_strat')
end

puts 'UI / API surface'
check.call('GraphQL MergeabilityCheckIdentifier has NOT_APPROVED') do
  Types::MergeRequests::MergeabilityCheckIdentifierEnum.values.key?('NOT_APPROVED')
end
check.call('GraphQL DetailedMergeStatus has NOT_APPROVED') do
  Types::MergeRequests::DetailedMergeStatusEnum.values.key?('NOT_APPROVED')
end
check.call('GraphQL schema builds') { GitlabSchema.to_definition.include?('NOT_APPROVED') }

puts 'data read through models'
check.call('MergeRequest#approvals -> Approval') { MergeRequest.reflect_on_association(:approvals)&.klass == Approval }
check.call('Approval#user') { Approval.reflect_on_association(:user).present? }
check.call('Approval#patch_id_sha') { Approval.column_names.include?('patch_id_sha') }
check.call('MergeRequest#modified_paths(fallback_on_overflow:)') do
  param_names(MergeRequest, :modified_paths).include?(:fallback_on_overflow)
end
check.call('MergeRequest reader methods') do
  %i[current_patch_id_sha target_branch_sha diff_head_sha committer_ids_to_filter_from_approvers target_project]
    .all? { |m| MergeRequest.method_defined?(m) }
end
check.call('Group#member?(user, level)') { param_names(Group, :member?).first(2) == %i[user min_access_level] }
check.call('Group.find_by_full_path') { Group.respond_to?(:find_by_full_path) }
check.call('Repository#blob_at') { Repository.method_defined?(:blob_at) }

puts 'note fallback'
check.call('Notes::CreateService / UpdateService') do
  defined?(Notes::CreateService) && defined?(Notes::UpdateService) &&
    param_names(Notes::UpdateService, :execute) == [:note]
end
check.call('Gitlab::ExclusiveLease#try_obtain/#cancel') do
  %i[try_obtain cancel].all? { |m| Gitlab::ExclusiveLease.method_defined?(m) }
end

puts 'rules parser'
check.call('parses example config') do
  rules = Dsoaas::Approvals::Rules.parse(<<~YAML)
    rules:
      - name: default
        required: 2
      - name: security
        required: 1
        paths: ["infra/**", "**/Dockerfile"]
        approvers: { groups: [security] }
    author_can_approve: false
  YAML
  rules.applicable(['README.md']).map(&:name) == ['default'] &&
    rules.applicable(['infra/k8s/app.yml']).map(&:name) == %w[default security] &&
    rules.applicable(['Dockerfile']).map(&:name) == %w[default security] &&
    rules.applicable(['svc/a/Dockerfile']).map(&:name) == %w[default security]
end
check.call('rejects invalid config') do
  bad = ["rules: []\n", "rules:\n  - name: x\n    required: 0\n", "rulez: []\n", "rules: [ { name: a, required: 1, foo: 1 } ]\n"]
  bad.all? do |yaml|
    Dsoaas::Approvals::Rules.parse(yaml)
    false
  rescue Dsoaas::Approvals::Rules::InvalidConfig
    true
  end
end

puts 'database isolation'
check.call('GitLab database.yml has no plugin entry') do
  !File.read(Rails.root.join('config/database.yml')).include?('dsoaas')
end
check.call('no plugin tables in GitLab DB') do
  ApplicationRecord.connection.select_values("SELECT tablename FROM pg_tables WHERE tablename LIKE 'dsoaas%'").empty?
end
if Dsoaas::PluginDB.configured?
  check.call('plugin DB reachable + migrated') do
    Dsoaas::PluginDB.with do |c|
      c.exec("SELECT to_regclass('dsoaas_approval_evaluations') IS NOT NULL").getvalue(0, 0) == 't'
    end == true
  end
else
  puts '  skip  plugin DB (DSOAAS_PLUGINS_DB_URL not set)'
end

puts
if failures.empty?
  puts "CONTRACT OK (#{passes} checks)"
else
  puts "CONTRACT FAILED (#{failures.size} failing, #{passes} ok):"
  failures.each { |f| puts "  - #{f}" }
  exit 1
end
