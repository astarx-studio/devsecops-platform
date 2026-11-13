# frozen_string_literal: true

# End-to-end approval scenario. CREATES users, groups, projects and merge
# requests, so it refuses to run anywhere except the throwaway canary
# container started by gitlab/test/canary.sh (DSOAAS_CANARY=1).
#
#   gitlab-rails runner /opt/dsoaas/test/e2e.rb

abort 'refusing to run: DSOAAS_CANARY=1 not set (this script writes test data)' unless ENV['DSOAAS_CANARY'] == '1'

require 'securerandom'

failures = []
step = lambda do |label, actual, expected|
  if actual == expected
    puts "  ok    #{label}"
  else
    failures << label
    puts "  FAIL  #{label}: expected #{expected.inspect}, got #{actual.inspect}"
  end
end

RUN = SecureRandom.hex(3)
admin = User.find_by_username!('root')
org = Organizations::Organization.first

def make_user(admin, org, name)
  username = "#{name}-#{RUN}"
  params = {
    username: username, name: name.capitalize, email: "#{username}@canary.test",
    password: "#{SecureRandom.hex(12)}Aa1!", skip_confirmation: true, organization_id: org&.id
  }
  result = Users::CreateService.new(admin, params).execute
  user = result.respond_to?(:payload) ? result.payload[:user] : result
  raise "user #{username}: #{result.try(:message) || user.errors.full_messages}" unless user&.persisted?

  user
end

# Detailed status as the API reports it, after settling GitLab's async git
# mergeability state (which a worker normally updates in the background).
def status(mr)
  mr = MergeRequest.find(mr.id)
  # A background worker may hold the mergeability lease for a moment; retry.
  # The first MR on a fresh instance can take a while (cold Gitaly merge refs).
  60.times do
    break unless mr.unchecked? || mr.checking? || mr.cannot_be_merged_rechecking?

    MergeRequests::MergeabilityCheckService.new(mr).execute(retry_lease: true)
    mr = MergeRequest.find(mr.id)
    next unless mr.unchecked? || mr.checking?

    mr.check_mergeability(async: false, sync_retry_lease: true)
    mr = MergeRequest.find(mr.id)
    sleep 1 if mr.unchecked? || mr.checking?
  end
  MergeRequests::Mergeability::DetailedMergeStatusService.new(merge_request: mr).execute
end

def approve(mr, user)
  mr = MergeRequest.find(mr.id)
  MergeRequests::ApprovalService.new(project: mr.project, current_user: user).execute(mr)
end

def commit_file(project, user, branch, path, content, start_branch: nil)
  start = start_branch || branch
  params = {
    branch_name: branch, start_branch: start, commit_message: "update #{path}",
    file_path: path, file_content: content
  }
  start_sha = project.repository.commit(start)&.id
  exists = start_sha && project.repository.blob_at(start_sha, path)
  service = exists ? Files::UpdateService : Files::CreateService
  # On a brand-new project, permissions/protected branches settle asynchronously.
  result = nil
  30.times do
    # Fresh user + project objects: both memoize access levels computed before
    # async authorization refresh landed.
    result = service.new(Project.find(project.id), User.find(user.id), params).execute
    break if result[:status] == :success || result[:message].to_s !~ /not allowed|Internal API error/

    sleep 2
  end
  raise "commit #{path}: #{result[:message]}" unless result[:status] == :success
end

def open_mr(project, author, source)
  project = Project.find(project.id)
  project.repository.expire_branches_cache
  MergeRequests::CreateService.new(
    project: project, current_user: author,
    params: { source_branch: source, target_branch: MAIN, title: "Change #{source}" }
  ).execute.tap do |mr|
    raise "MR: #{mr.errors.full_messages}" unless mr.persisted?

    wait_until_prepared(mr, project.repository.commit(source).id)
  end
end

# In production Sidekiq builds the MR diff (NewMergeRequestWorker, and a refresh
# on push). Inside `rails runner` those jobs only go out once the script exits, so
# run the same steps inline. Until the diff exists, GitLab's own commits_status
# check fails first and would hide ours.
def wait_until_prepared(mr, head_sha)
  mr = MergeRequest.find(mr.id)
  NewMergeRequestWorker.new.perform(mr.id, mr.author_id) if mr.preparing?

  mr = MergeRequest.find(mr.id)
  mr.reload_diff(mr.author) unless mr.merge_request_diff&.head_commit_sha == head_sha

  mr = MergeRequest.find(mr.id)
  diff = mr.merge_request_diff
  unless diff&.head_commit_sha == head_sha && mr.commits_count.to_i.positive? && !mr.preparing?
    raise "MR !#{mr.iid} not prepared: diff=#{diff&.head_commit_sha} want=#{head_sha} " \
          "commits=#{mr.commits_count} status=#{mr.merge_status}"
  end

  mr.mark_as_unchecked if mr.can_be_merged? && mr.respond_to?(:mark_as_unchecked)
  mr.check_mergeability(async: false)
  MergeRequest.find(mr.id)
end

puts "DSOaaS approvals e2e (run #{RUN}) - GitLab #{Gitlab::VERSION}"

alice = make_user(admin, org, 'alice')
bob   = make_user(admin, org, 'bob')
carol = make_user(admin, org, 'carol') # security group member
dave  = make_user(admin, org, 'dave')  # MR author
bot   = make_user(admin, org, 'botty') # status-note author
ENV['DSOAAS_APPROVALS_BOT_USERNAME'] = bot.username

security = Groups::CreateService.new(admin, { name: "security-#{RUN}", path: "security-#{RUN}", organization_id: org&.id }).execute
security = security.payload[:group] if security.respond_to?(:payload)
security.add_member(carol, :developer)

project = Projects::CreateService.new(admin, {
  name: "approvals-#{RUN}", path: "approvals-#{RUN}", namespace_id: admin.namespace.id,
  initialize_with_readme: true, default_branch: 'main', organization_id: org&.id
}).execute
raise "project: #{project.errors.full_messages}" unless project.persisted?
MAIN = project.default_branch || 'main'
# Scratch project only: drop default-branch protection so the test can commit the
# rules file directly. Protection doesn't affect what is tested; on a brand-new
# project it races with async permission refresh and makes direct commits flaky.
AuthorizedProjectUpdate::ProjectRecalculateService.new(project).execute if defined?(AuthorizedProjectUpdate::ProjectRecalculateService)
60.times do
  break if ProjectAuthorization.exists?(project: project, user: admin) &&
    Gitlab::UserAccess.new(User.find(admin.id), container: Project.find(project.id)).can_push_to_branch?(MAIN)

  sleep 2
end
project.protected_branches.reload.each(&:destroy)
puts "  default branch: #{MAIN}"

[alice, bob, carol, dave].each { |u| project.add_member(u, :developer) }
AuthorizedProjectUpdate::ProjectRecalculateService.new(project).execute if defined?(AuthorizedProjectUpdate::ProjectRecalculateService)
[alice, bob, carol, dave].each { |u| u.refresh_authorized_projects rescue nil } # rubocop:disable Style/RescueModifier
project.update!(merge_requests_author_approval: true) if project.respond_to?(:merge_requests_author_approval)

puts 'stock behaviour without rules file'
commit_file(project, admin, 'feature-norules', 'notes.txt', "hello\n", start_branch: MAIN)
mr0 = open_mr(project, dave, 'feature-norules')
# Asserted on the merge-state checks (where the plugin lives) rather than the
# detailed status, whose git merge-ref part races with background jobs on a
# freshly booted instance and has nothing to do with the plugin.
mr0 = MergeRequest.find(mr0.id)
plugin_result = Dsoaas::Approvals::CheckApprovalRulesService.new(merge_request: mr0, params: {}).execute
step.call('no rules file -> plugin check inactive', plugin_result.status, :inactive)
step.call('no rules file -> all merge-state checks pass', mr0.mergeable_state?(use_cache: false), true)

puts 'rules file on main'
commit_file(project, admin, MAIN, '.gitlab/approvals.yml', <<~YAML)
  rules:
    - name: default
      required: 2
    - name: security
      required: 1
      paths: ["infra/**"]
      approvers: { groups: [security-#{RUN}] }
  author_can_approve: false
  reset_on_push: true
YAML

commit_file(project, admin, 'feature-a', 'app.txt', "v1\n", start_branch: MAIN)
mr = open_mr(project, dave, 'feature-a')
step.call('no approvals -> not_approved', status(mr), :not_approved)
step.call('mergeable? false', MergeRequest.find(mr.id).mergeable?, false)

approve(mr, dave)
step.call('author approval ignored', status(mr), :not_approved)
approve(mr, alice)
step.call('1/2 -> not_approved', status(mr), :not_approved)
approve(mr, bob)
step.call('2/2 -> mergeable', status(mr), :mergeable)

puts 'reset_on_push'
commit_file(project, admin, 'feature-a', 'app.txt', "v2\n")
mr = wait_until_prepared(mr, project.repository.commit('feature-a').id)
step.call('new push -> approvals reset', status(mr), :not_approved)

puts 'path rule'
commit_file(project, admin, 'feature-infra', 'infra/main.tf', "# tf\n", start_branch: MAIN)
mri = open_mr(project, dave, 'feature-infra')
approve(mri, alice)
approve(mri, bob)
step.call('default satisfied, security missing', status(mri), :not_approved)
approve(mri, carol)
step.call('security approval -> mergeable', status(mri), :mergeable)

puts 'rules from target branch only'
commit_file(project, admin, 'feature-weaken', '.gitlab/approvals.yml', "rules:\n  - name: default\n    required: 1\n", start_branch: MAIN)
mrw = open_mr(project, dave, 'feature-weaken')
approve(mrw, alice)
step.call('MR cannot weaken its own rules', status(mrw), :not_approved)

puts 'console rules (plugin DB) win over the file'
if Dsoaas::PluginDB.configured?
  set_console_rules = lambda do |config|
    ok = Dsoaas::PluginDB.with do |c|
      if config
        c.exec_params(<<~SQL, [project.id, config.to_json])
          INSERT INTO dsoaas_approval_rule_sets (project_id, config, updated_by) VALUES ($1, $2::jsonb, 'e2e')
          ON CONFLICT (project_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
        SQL
      else
        c.exec_params('DELETE FROM dsoaas_approval_rule_sets WHERE project_id = $1', [project.id])
      end
      true
    end
    raise 'plugin DB write failed' unless ok

    Dsoaas::Approvals::RulesStore.expire(project.id)
  end
  source = -> { Dsoaas::Approvals::Evaluator.new(MergeRequest.find(mrw.id)).call.source }

  # mrw has 1 approval (alice); the file on the target branch asks for 2.
  set_console_rules.call({ rules: [{ name: 'console', required: 1 }] })
  step.call('console rule (1) satisfied -> mergeable', status(mrw), :mergeable)
  step.call('source is console', source.call, :console)

  set_console_rules.call({ rules: [{ name: 'console', required: 3 }] })
  step.call('stricter console rule -> not_approved', status(mrw), :not_approved)

  set_console_rules.call({ rules: [] })
  step.call('invalid console rules fail closed', status(mrw), :not_approved)

  set_console_rules.call(nil)
  step.call('console rules removed -> file applies again', status(mrw), :not_approved)
  step.call('source is file', source.call, :file)
else
  puts '  skip  plugin DB not configured'
end

puts 'invalid rules fail closed'
commit_file(project, admin, MAIN, '.gitlab/approvals.yml', "rules: nope\n")
commit_file(project, admin, 'feature-b', 'b.txt', "b\n", start_branch: MAIN)
mrb = open_mr(project, dave, 'feature-b')
[alice, bob, carol].each { |u| approve(mrb, u) }
step.call('invalid rules -> not_approved', status(mrb), :not_approved)

puts 'status note'
notes = MergeRequest.find(mri.id).notes.where(author_id: bot.id).to_a
step.call('exactly one bot note per MR', notes.size, 1)
body = notes.first&.note.to_s
step.call('note shows the security rule as satisfied', body.include?('`security` | 1/1'), true)
step.call('note has no @mentions', body.include?('@'), false)

puts 'plugin database'
if Dsoaas::PluginDB.configured?
  count = Dsoaas::PluginDB.with do |c|
    c.exec_params('SELECT count(*) FROM dsoaas_approval_evaluations WHERE project_id = $1', [project.id]).getvalue(0, 0).to_i
  end
  step.call('audit rows written to plugin DB', count.to_i.positive?, true)
else
  puts '  skip  plugin DB not configured'
end

puts
if failures.empty?
  puts 'E2E OK'
else
  puts "E2E FAILED: #{failures.join('; ')}"
  exit 1
end
