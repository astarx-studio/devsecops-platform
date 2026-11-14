# frozen_string_literal: true

module Dsoaas
  module Approvals
    # Evaluates a merge request against its project's approval rules:
    #   1. native rules, managed in GitLab (Settings > Merge requests, or the
    #      EE-compatible REST API), stored in the plugin DB (see RulesStore), else
    #   2. `.gitlab/approvals.yml` read from the TARGET branch (so an MR can't
    #      weaken the rules that govern it), else
    #   3. none: stock CE behaviour.
    #
    # A rule applies when the MR's target branch and changed paths match it. It is
    # met when enough eligible people approved ("any N"), or when every listed
    # person approved (require_all). One approval counts toward every rule its
    # author is eligible for, as in GitLab EE.
    #
    # Reads go through GitLab models only. It never writes and never issues raw SQL
    # against GitLab tables.
    class Evaluator
      DISPLAY_LIMIT = 50

      # Normalized rule, whichever source it came from.
      EvalRule = Struct.new(:id, :name, :rule_type, :approvals_required, :require_all, :user_ids, :unknown_users,
        :group_ids, :branches, :all_protected, :paths, keyword_init: true) do
        def any_approver?
          user_ids.empty? && group_ids.empty? && unknown_users.empty?
        end

        def required
          require_all ? user_ids.size + unknown_users.size : approvals_required
        end
      end

      Ruleset = Struct.new(:rules, :author_can_approve, :committers_can_approve, :reset_on_push, keyword_init: true)

      RuleResult = Struct.new(:id, :name, :rule_type, :required, :require_all, :any_approver, :approved_users,
        :eligible_users, :listed_users, :groups, :branches, :all_protected, :paths, :unsatisfiable,
        keyword_init: true) do
        def approved_by
          approved_users.map(&:username)
        end

        def satisfied?
          unsatisfiable.nil? && approved_users.size >= required
        end

        def approvals_left
          [required - approved_users.size, 0].max
        end

        def to_h
          { id: id, name: name, rule_type: rule_type, required: required, require_all: require_all,
            approved_by: approved_by, satisfied: satisfied?, unsatisfiable: unsatisfiable }
        end
      end

      Result = Struct.new(:state, :rule_results, :error, :source, keyword_init: true) do
        # :inactive -> no rules anywhere (stock CE behaviour)
        # :passed / :failed -> rules evaluated
        # :invalid  -> rules broken or unreadable; treated as failed (fail-closed)
        # source: :native or :file
        def blocking?
          %i[failed invalid].include?(state)
        end

        def approvals_required
          Array(rule_results).sum(&:required)
        end

        def approvals_left
          Array(rule_results).sum(&:approvals_left)
        end

        def summary
          { state: state, source: source, error: error, rules: Array(rule_results).map(&:to_h) }
        end
      end

      RULES_CACHE_TTL = 1.hour

      def initialize(merge_request)
        @merge_request = merge_request
      end

      def call
        @source = nil
        ruleset = load_ruleset
        return Result.new(state: :inactive, rule_results: []) if ruleset.nil?

        @ruleset = ruleset
        applicable = ruleset.rules.select { |rule| applies?(rule) }
        results = applicable.map { |rule| evaluate(rule) }

        Result.new(state: results.all?(&:satisfied?) ? :passed : :failed, rule_results: results, source: @source)
      rescue Rules::InvalidConfig => e
        where = @source == :native ? 'approval rules' : Rules::PATH
        Result.new(state: :invalid, rule_results: [], error: "#{where}: #{e.message}", source: @source)
      end

      private

      attr_reader :merge_request, :ruleset

      def project
        merge_request.target_project
      end

      # --- loading ------------------------------------------------------------

      # Native rules win; the repository file is the fallback. nil when neither exists.
      def load_ruleset
        entry = RulesStore.fetch(project.id)
        case entry.state
        when :found
          @source = :native
          return native_ruleset(entry)
        when :unavailable
          # Can't tell whether this project has native rules: block rather than
          # silently fall back to weaker (or no) rules.
          @source = :native
          raise Rules::InvalidConfig, 'rules store unavailable, try again shortly'
        end

        @source = :file
        file = load_rules_file
        file && file_ruleset(file)
      end

      def native_ruleset(entry)
        settings = entry.settings
        rules = entry.rules.map do |row|
          EvalRule.new(
            id: row['id'], name: row['name'].to_s, rule_type: 'regular',
            approvals_required: row['approvals_required'].to_i, require_all: row['require_all'] == true,
            user_ids: Array(row['user_ids']).map(&:to_i), unknown_users: [],
            group_ids: Array(row['group_ids']).map(&:to_i), branches: Array(row['branches']),
            all_protected: row['applies_to_all_protected_branches'] == true, paths: Array(row['paths'])
          )
        end

        Ruleset.new(
          rules: rules,
          author_can_approve: settings['merge_requests_author_approval'] == true,
          committers_can_approve: settings['merge_requests_disable_committers_approval'] != true,
          reset_on_push: settings['reset_approvals_on_push'] != false
        )
      end

      def file_ruleset(file)
        usernames = file.rules.flat_map(&:users).uniq
        users_by_name = usernames.empty? ? {} : ::User.by_username(usernames).index_by { |u| u.username.downcase }

        rules = file.rules.map do |rule|
          found, missing = rule.users.partition { |name| users_by_name.key?(name.downcase) }
          EvalRule.new(
            id: nil, name: rule.name, rule_type: 'file', approvals_required: rule.required,
            require_all: rule.require_all == true,
            user_ids: found.map { |name| users_by_name[name.downcase].id }, unknown_users: missing,
            group_ids: rule.groups.filter_map { |path| ::Group.find_by_full_path(path)&.id },
            branches: Array(rule.branches), all_protected: false, paths: rule.paths
          )
        end

        Ruleset.new(rules: rules, author_can_approve: file.author_can_approve,
          committers_can_approve: file.committers_can_approve, reset_on_push: file.reset_on_push)
      end

      # nil when the target branch has no rules file.
      def load_rules_file
        sha = merge_request.target_branch_sha
        raise Rules::InvalidConfig, "target branch #{merge_request.target_branch} not found" if sha.blank?

        content = Rails.cache.fetch(['dsoaas', 'approvals-yml', project.id, sha], expires_in: RULES_CACHE_TTL) do
          blob = project.repository.blob_at(sha, Rules::PATH)
          blob ? blob.data.to_s : ''
        end
        return if content.empty?

        Rules.parse(content)
      end

      # --- applicability ------------------------------------------------------

      def applies?(rule)
        branch_matches?(rule) && paths_match?(rule)
      end

      def branch_matches?(rule)
        target = merge_request.target_branch.to_s
        return ::ProtectedBranch.protected?(project, target) if rule.all_protected
        return true if rule.branches.empty?

        rule.branches.any? { |pattern| File.fnmatch?(pattern, target, File::FNM_EXTGLOB) }
      end

      def paths_match?(rule)
        return true if rule.paths.empty?

        changed_paths.any? { |path| rule.paths.any? { |glob| Rules.glob_match?(glob, path) } }
      end

      def changed_paths
        @changed_paths ||= merge_request.modified_paths(fallback_on_overflow: true)
      end

      # --- evaluation ---------------------------------------------------------

      def evaluate(rule)
        listed = listed_ids(rule) # nil = anyone who can approve
        approved = valid_approvals.filter_map do |approval|
          user = approval.user
          next unless user&.active?
          next if excluded.key?(user.id)
          next if listed && !listed.include?(user.id)

          user
        end.uniq(&:id)

        candidates = candidate_ids(listed)

        RuleResult.new(
          id: rule.id, name: rule.name, rule_type: rule.rule_type, required: rule.required,
          require_all: rule.require_all, any_approver: rule.any_approver?,
          approved_users: approved.sort_by(&:username),
          eligible_users: users_for((candidates - approved.map(&:id)).first(DISPLAY_LIMIT)),
          listed_users: users_for(rule.user_ids), groups: groups_for(rule.group_ids),
          branches: rule.branches, all_protected: rule.all_protected, paths: rule.paths,
          unsatisfiable: unsatisfiable_reason(rule, approved, candidates)
        )
      end

      # Why a rule can never be met as things stand, or nil.
      def unsatisfiable_reason(rule, approved, candidates)
        approved_ids = approved.map(&:id)

        if rule.require_all
          return "#{rule.unknown_users.first} doesn't exist" if rule.unknown_users.any?

          rule.user_ids.each do |id|
            next if approved_ids.include?(id) || candidates.include?(id)

            return "#{username_for(id)} can't approve this merge request (#{cannot_approve_reason(id)})"
          end
          return nil
        end

        possible = (approved_ids | candidates).size
        return nil if possible >= rule.required

        noun = possible == 1 ? 'person' : 'people'
        "needs #{rule.required} approval#{'s' unless rule.required == 1}, but only #{possible} #{noun} can approve"
      end

      def cannot_approve_reason(user_id)
        user = users_index[user_id]
        return 'account no longer exists' unless user
        return 'account is not active' unless user.active?
        return excluded[user_id] if excluded.key?(user_id)

        'needs the Developer role or higher in this project'
      end

      # People named by the rule (users + group members), or nil for "anyone".
      def listed_ids(rule)
        return nil if rule.any_approver?

        Set.new(rule.user_ids) | rule.group_ids.flat_map { |gid| group_member_ids(gid) }
      end

      # Who could still approve: listed (or any project member), active, Developer+,
      # not excluded as author/committer.
      def candidate_ids(listed)
        base = listed ? listed.to_a & developer_ids : developer_ids
        base.select { |id| users_index[id]&.active? && !excluded.key?(id) }
      end

      def developer_ids
        @developer_ids ||= ::ProjectAuthorization.where(project_id: project.id)
          .where('access_level >= ?', ::Gitlab::Access::DEVELOPER).pluck(:user_id)
      end

      def group_member_ids(group_id)
        @group_members ||= {}
        @group_members[group_id] ||= begin
          group = ::Group.find_by_id(group_id)
          group ? group.members_with_parents.pluck(:user_id) : []
        end
      end

      def excluded
        @excluded ||= begin
          reasons = {}
          reasons[merge_request.author_id] = 'author' unless ruleset.author_can_approve
          unless ruleset.committers_can_approve
            merge_request.committer_ids_to_filter_from_approvers.map(&:id).each do |id|
              reasons[id] ||= 'added commits'
            end
          end
          reasons
        end
      end

      def valid_approvals
        @valid_approvals ||= begin
          approvals = merge_request.approvals.includes(:user).to_a
          if ruleset.reset_on_push
            current_patch = merge_request.current_patch_id_sha
            diff_created_at = merge_request.merge_request_diff&.created_at
            approvals.select do |approval|
              if approval.patch_id_sha.present? && current_patch.present?
                approval.patch_id_sha == current_patch
              elsif diff_created_at
                approval.created_at >= diff_created_at
              else
                true
              end
            end
          else
            approvals
          end
        end
      end

      # One query for every user the evaluation needs to look at.
      def users_index
        @users_index ||= begin
          ids = ruleset.rules.flat_map(&:user_ids) + developer_ids +
            ruleset.rules.flat_map(&:group_ids).flat_map { |gid| group_member_ids(gid) }
          ::User.where(id: ids.uniq).index_by(&:id)
        end
      end

      def users_for(ids)
        ids.filter_map { |id| users_index[id] }
      end

      def username_for(id)
        users_index[id]&.username || "user ##{id}"
      end

      def groups_for(ids)
        ids.empty? ? [] : ::Group.where(id: ids).to_a
      end
    end
  end
end
