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

def open_mr(project, author, source, target: MAIN)
  project = Project.find(project.id)
  project.repository.expire_branches_cache
  MergeRequests::CreateService.new(
    project: project, current_user: author,
    params: { source_branch: source, target_branch: target, title: "Change #{source}" }
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

# Scratch project with a README on `main`, members added and default-branch
# protection removed (it races with async permission refresh on new projects and
# isn't what these tests exercise).
def make_project(admin, org, name, members = {})
  project = Projects::CreateService.new(admin, {
    name: "#{name}-#{RUN}", path: "#{name}-#{RUN}", namespace_id: admin.namespace.id,
    initialize_with_readme: true, default_branch: 'main', organization_id: org&.id
  }).execute
  raise "project: #{project.errors.full_messages}" unless project.persisted?

  members.each { |user, level| project.add_member(user, level) }
  AuthorizedProjectUpdate::ProjectRecalculateService.new(project).execute
  60.times do
    break if Gitlab::UserAccess.new(User.find(admin.id), container: Project.find(project.id))
      .can_push_to_branch?(project.default_branch || 'main')

    sleep 2
  end
  project.protected_branches.reload.each(&:destroy)
  Project.find(project.id)
end

TOKENS = {}
def token_for(user, org)
  TOKENS[user.id] ||= begin
    token = PersonalAccessToken.new(user: user, name: "e2e-#{RUN}", scopes: %w[api], expires_at: 2.days.from_now)
    token.organization_id = org.id if token.respond_to?(:organization_id=) && org
    token.save!
    token.token
  end
end

# A real REST request through the whole Rails stack (middleware included).
def rest(method, path, user, org, body = nil)
  env = { 'HTTP_PRIVATE_TOKEN' => token_for(user, org), 'CONTENT_TYPE' => 'application/json',
          'HTTP_ACCEPT' => 'application/json', input: body ? body.to_json : '' }
  res = Rack::MockRequest.new(Rails.application).request(method.to_s.upcase, "/api/v4#{path}", env)
  data = res.body.empty? ? nil : (JSON.parse(res.body) rescue res.body) # rubocop:disable Style/RescueModifier
  [res.status, data]
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

puts 'GitLab-managed rules win over the file'
if Dsoaas::PluginDB.configured?
  native = Dsoaas::Approvals::RuleService.new(Project.find(project.id), admin)
  source = -> { Dsoaas::Approvals::Evaluator.new(MergeRequest.find(mrw.id)).call.source }

  # mrw has 1 approval (alice); the file on the target branch asks for 2.
  rule = native.create(name: 'native', approvals_required: 1)
  step.call('native rule (1) satisfied -> mergeable', status(mrw), :mergeable)
  step.call('source is native', source.call, :native)

  native.update(rule['id'], approvals_required: 3)
  step.call('stricter native rule -> not_approved', status(mrw), :not_approved)

  native.destroy(rule['id'])
  step.call('native rules removed -> file applies again', status(mrw), :not_approved)
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

if Dsoaas::PluginDB.configured?
  puts 'native rules via the EE-compatible REST API'
  lead1 = make_user(admin, org, 'lead1')
  lead2 = make_user(admin, org, 'lead2')
  rita  = make_user(admin, org, 'rita') # Reporter: can't approve
  np = make_project(admin, org, 'native', { lead1 => :developer, lead2 => :developer, alice => :developer,
    bob => :developer, carol => :developer, dave => :developer, rita => :reporter })
  base = "/projects/#{np.id}"
  state = ->(mr) { rest(:get, "#{base}/merge_requests/#{mr.iid}/approval_state", admin, org).last }
  rule_state = ->(mr, name) { state.call(mr)['rules'].find { |r| r['name'] == name } }

  code, = rest(:post, "#{base}/approval_rules", bob, org, { name: 'nope', approvals_required: 1 })
  step.call('developer cannot create rules (403)', code, 403)
  code, body = rest(:get, "#{base}/approval_rules", bob, org)
  step.call('developer can list rules', [code, body], [200, []])

  puts 'case study 1: two leads, either one'
  code, leads = rest(:post, "#{base}/approval_rules", admin, org,
    { name: 'Leads', approvals_required: 1, user_ids: [lead1.id, lead2.id] })
  step.call('maintainer creates rule (201)', code, 201)
  step.call('rule has EE shape', [leads['rule_type'], leads['approvals_required'], leads['users'].size],
    ['regular', 1, 2])
  commit_file(np, admin, 'case-1', 'one.txt', "1\n", start_branch: 'main')
  mr1 = open_mr(np, dave, 'case-1', target: 'main')
  step.call('no approvals -> not_approved', status(mr1), :not_approved)
  step.call('approvers listed upfront', rule_state.call(mr1, 'Leads')['users'].map { |u| u['id'] }.sort,
    [lead1.id, lead2.id].sort)
  approve(mr1, bob)
  step.call('non-lead approval does not count', status(mr1), :not_approved)
  approve(mr1, lead2)
  step.call('one lead approves -> mergeable', status(mr1), :mergeable)
  code, = rest(:delete, "#{base}/approval_rules/#{leads['id']}", admin, org)
  step.call('rule deleted (204)', code, 204)

  puts 'case study 2: 3 approvals including a specific person'
  rest(:post, "#{base}/approval_rules", admin, org, { name: 'Consensus', approvals_required: 3 })
  code, signoff = rest(:post, "#{base}/approval_rules", admin, org,
    { name: 'Sign-off', require_all: true, usernames: [alice.username] })
  step.call('require_all rule created', [code, signoff['require_all'], signoff['approvals_required']], [201, true, 1])
  commit_file(np, admin, 'case-2', 'two.txt', "2\n", start_branch: 'main')
  mr2 = open_mr(np, dave, 'case-2', target: 'main')
  [bob, carol, lead1].each { |u| approve(mr2, u) }
  step.call('3 approvals without alice -> not_approved', status(mr2), :not_approved)
  step.call('Consensus met, Sign-off not', [rule_state.call(mr2, 'Consensus')['approved'],
    rule_state.call(mr2, 'Sign-off')['approved']], [true, false])
  approve(mr2, alice)
  step.call('alice approves -> mergeable', status(mr2), :mergeable)
  code, approvals = rest(:get, "#{base}/merge_requests/#{mr2.iid}/approvals", admin, org)
  step.call('CE approvals endpoint has EE fields', [code, approvals['approvals_left'], approvals['approval_rules_left']],
    [200, 0, []])

  puts 'unsatisfiable rules'
  code, body = rest(:post, "#{base}/approval_rules", admin, org,
    { name: 'Reporter sign-off', require_all: true, user_ids: [rita.id] })
  step.call('require_all with a Reporter refused (400)', [code, body.to_s.include?("can't approve")], [400, true])
  code, = rest(:post, "#{base}/approval_rules", admin, org, { name: 'Too many', approvals_required: 50 })
  step.call('more approvals than eligible people refused (400)', code, 400)
  code, = rest(:post, "#{base}/approval_rules", admin, org, { name: 'Consensus', approvals_required: 1 })
  step.call('duplicate name refused (400)', code, 400)
  code, = rest(:post, "#{base}/approval_rules", admin, org, { name: 'Ghost', usernames: ['no-such-user-x'] })
  step.call('unknown user refused (400)', code, 400)
  User.find(alice.id).block!
  step.call('required approver blocked -> not_approved', status(mr2), :not_approved)
  step.call('reason shown', rule_state.call(mr2, 'Sign-off')['unsatisfiable'].to_s.include?(alice.username), true)
  User.find(alice.id).activate!
  step.call('approver unblocked -> mergeable again', status(mr2), :mergeable)

  puts 'target branch scoping'
  rest(:post, "#{base}/approval_rules", admin, org, { name: 'Release', approvals_required: 2, branches: ['release/*'] })
  step.call('release/* rule does not apply to main', rule_state.call(mr2, 'Release'), nil)
  commit_file(np, admin, 'release/1.0', 'r.txt', "r\n", start_branch: 'main')
  commit_file(np, admin, 'case-3', 'three.txt', "3\n", start_branch: 'release/1.0')
  mr3 = open_mr(np, dave, 'case-3', target: 'release/1.0')
  step.call('release/* rule applies to release/1.0', rule_state.call(mr3, 'Release')&.dig('approvals_required'), 2)

  puts 'branch rules: approval rules linked to a branch rule'
  pb = ProtectedBranches::CreateService.new(np, admin, {
    name: 'release/1.0',
    push_access_levels_attributes: [{ access_level: Gitlab::Access::MAINTAINER }],
    merge_access_levels_attributes: [{ access_level: Gitlab::Access::MAINTAINER }]
  }).execute
  step.call('branch rule created', pb.persisted?, true)
  code, linked = rest(:post, "#{base}/approval_rules", admin, org,
    { name: 'Release lead', approvals_required: 1, user_ids: [lead1.id], branches: ['release/1.0', 'support/*'] })
  step.call('branch rule name linked by id, other pattern kept',
    [code, linked['protected_branches'].map { |b| b['id'] }, linked['branches']], [201, [pb.id], ['support/*']])
  step.call('linked rule applies', rule_state.call(mr3, 'Release lead')&.dig('approvals_required'), 1)
  ProtectedBranches::UpdateService.new(np, admin, { name: 'hotfix/*' }).execute(pb)
  _, renamed = rest(:get, "#{base}/approval_rules/#{linked['id']}", admin, org)
  step.call('renamed branch rule: approval rule follows it', renamed['protected_branches'].map { |b| b['name'] }, ['hotfix/*'])
  step.call('no longer applies to release/1.0', rule_state.call(mr3, 'Release lead'), nil)
  ProtectedBranch.find(pb.id).destroy!
  _, orphan = rest(:get, "#{base}/approval_rules/#{linked['id']}", admin, org)
  step.call('deleted branch rule: falls back to its saved name',
    [orphan['protected_branches'], orphan['branches'].sort], [[], ['release/1.0', 'support/*']])
  step.call('fallback name still enforced', rule_state.call(mr3, 'Release lead')&.dig('approvals_required'), 1)
  code, edited = rest(:put, "#{base}/approval_rules/#{linked['id']}", admin, org, { approvals_required: 2, user_ids: [lead1.id, lead2.id] })
  step.call('partial update keeps targets', [code, edited['branches'].sort], [200, ['release/1.0', 'support/*']])
  rest(:delete, "#{base}/approval_rules/#{linked['id']}", admin, org)

  puts 'branch rules migration links existing patterns'
  stable = ProtectedBranches::CreateService.new(np, admin, {
    name: 'stable',
    push_access_levels_attributes: [{ access_level: Gitlab::Access::MAINTAINER }],
    merge_access_levels_attributes: [{ access_level: Gitlab::Access::MAINTAINER }]
  }).execute
  Dsoaas::PluginDB.with do |c|
    c.exec_params(<<~SQL, [np.id])
      INSERT INTO dsoaas_approval_rules (project_id, name, approvals_required, branches)
      VALUES ($1, 'Pre-link', 1, ARRAY['stable', 'feature/*'])
    SQL
    migration = Module.new.module_eval(File.read(File.join(Dsoaas::Approvals::DIR, 'migrations', '004_link_protected_branches.rb')))
    c.transaction { |tx| migration.call(tx) }
  end
  Dsoaas::Approvals::RulesStore.expire(np.id)
  _, all_rules = rest(:get, "#{base}/approval_rules", admin, org)
  pre = all_rules.find { |r| r['name'] == 'Pre-link' }
  step.call('existing branch name became a link', pre && [pre['protected_branches'].map { |b| b['id'] }, pre['branches']],
    [[stable.id], ['feature/*']])
  rest(:delete, "#{base}/approval_rules/#{pre['id']}", admin, org) if pre

  puts 'GitLab pages carry the plugin UI (rendered through Rails as a signed-in maintainer)'
  require 'warden'
  Warden.test_mode!
  page = lambda do |path|
    Warden.on_next_request { |proxy| proxy.set_user(User.find(admin.id), scope: :user, event: :authentication) }
    res = Rack::MockRequest.new(Rails.application).get(path, 'HTTP_ACCEPT' => 'text/html')
    [res.status, res.body.to_s]
  end
  code, html = page.call("/#{np.full_path}/-/merge_requests/#{mr3.iid}")
  step.call('MR page: widget script injected', [code, html.include?('data-dsoaas-approvals'),
    html.include?(%(data-iid="#{mr3.iid}"))], [200, true, true])
  code, html = page.call("/#{np.full_path}/-/settings/repository/branch_rules?branch=stable")
  step.call('branch rule page: CE mount point + our script',
    [code, html.include?('id="js-branch-rules"'), html.include?('data-can-admin-protected-branches="true"'),
      html.include?('data-dsoaas-branch-rules') && html.include?('data-mode="details"')], [200, true, true, true])
  code, html = page.call("/#{np.full_path}/-/settings/repository")
  step.call('branch rules list: CE mount point + our script',
    [code, html.include?('id="js-branch-rules-listing"'), html.include?('data-mode="list"')], [200, true, true])
  code, html = page.call("/#{np.full_path}/-/settings/merge_requests")
  step.call('MR settings: approvals section rendered with the shared editor',
    [code, html.include?('id="js-dsoaas-approval-settings"'), html.include?('Merge request approvals'),
      html.include?('/assets/dsoaas/editor-')], [200, true, true, true])
  code, html = page.call("/#{np.full_path}/-/branches")
  step.call('other pages untouched', [code, html.include?('data-dsoaas')], [200, false])
  Warden.test_reset!

  puts 'approval settings'
  code, settings = rest(:post, "#{base}/approvals", admin, org, { merge_requests_author_approval: true })
  step.call('settings saved', [code, settings['merge_requests_author_approval']], [201, true])
  code, = rest(:post, "#{base}/approvals", bob, org, { reset_approvals_on_push: false })
  step.call('developer cannot change settings (403)', code, 403)

  puts 'audit trail'
  events = Dsoaas::PluginDB.with do |c|
    c.exec_params('SELECT action FROM dsoaas_approval_rule_events WHERE project_id = $1', [np.id]).column_values(0)
  end
  step.call('rule changes audited', (%w[rule.created rule.deleted settings.updated] - events.to_a).empty?, true)

  puts 'legacy console rules migrate'
  lp = make_project(admin, org, 'legacy', { alice => :developer })
  Dsoaas::PluginDB.with do |c|
    c.exec_params('INSERT INTO dsoaas_approval_rule_sets (project_id, config) VALUES ($1, $2::jsonb)',
      [lp.id, { rules: [{ name: 'old', required: 1, approvers: { users: [alice.username, 'gone-user'] } }],
                author_can_approve: false }.to_json])
    migration = Module.new.module_eval(File.read(File.join(Dsoaas::Approvals::DIR, 'migrations', '003_native_rules.rb')))
    c.transaction { |tx| migration.call(tx) }
  end
  Dsoaas::Approvals::RulesStore.expire(lp.id)
  migrated = Dsoaas::Approvals::RulesStore.fetch(lp.id).rules.first
  step.call('legacy rule migrated with ids', migrated && [migrated['name'], migrated['user_ids']], ['old', [alice.id]])
end

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
