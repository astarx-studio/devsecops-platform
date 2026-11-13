# frozen_string_literal: true

module Dsoaas
  module Approvals
    # Evaluates a merge request against its project's approval rules:
    #   1. rules set in the platform console (plugin DB, see RulesStore), else
    #   2. `.gitlab/approvals.yml` read from the TARGET branch (so an MR can't
    #      weaken the rules that govern it), else
    #   3. none: stock CE behaviour.
    #
    # Reads go through GitLab models only (MergeRequest, Approval, User, Group,
    # repository blobs). It never writes and never issues raw SQL against GitLab tables.
    class Evaluator
      RuleResult = Struct.new(:name, :required, :approved_by, keyword_init: true) do
        def satisfied?
          approved_by.size >= required
        end

        def to_h
          { name: name, required: required, approved_by: approved_by, satisfied: satisfied? }
        end
      end

      Result = Struct.new(:state, :rule_results, :error, :source, keyword_init: true) do
        # :inactive -> no rules anywhere (stock CE behaviour)
        # :passed / :failed -> rules evaluated
        # :invalid  -> rules broken or unreadable; treated as failed (fail-closed)
        # source: :console or :file
        def blocking?
          %i[failed invalid].include?(state)
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
        rules = load_rules
        return Result.new(state: :inactive, rule_results: []) if rules.nil?

        approvals = valid_approvals(rules)
        excluded = excluded_user_ids(rules)
        # Diff paths are only needed for path rules; skip that work otherwise.
        applicable = rules.rules.any? { |r| r.paths.any? } ? rules.applicable(changed_paths) : rules.rules

        results = applicable.map do |rule|
          approvers = approvals.filter_map do |approval|
            user = approval.user
            next unless user&.active?
            next if excluded.include?(user.id)
            next unless eligible?(rule, user)

            user.username
          end

          RuleResult.new(name: rule.name, required: rule.required, approved_by: approvers.uniq.sort)
        end

        Result.new(state: results.all?(&:satisfied?) ? :passed : :failed, rule_results: results, source: @source)
      rescue Rules::InvalidConfig => e
        where = @source == :console ? 'console rules' : Rules::PATH
        Result.new(state: :invalid, rule_results: [], error: "#{where}: #{e.message}", source: @source)
      end

      private

      attr_reader :merge_request

      def project
        merge_request.target_project
      end

      # Console rules win; the repository file is the fallback. nil when neither exists.
      def load_rules
        entry = RulesStore.fetch(project.id)
        case entry.state
        when :found
          @source = :console
          raise Rules::InvalidConfig, 'stored rules are not a mapping' unless entry.config.is_a?(Hash)

          return Rules.new(entry.config)
        when :unavailable
          # Can't tell whether this project has console rules: block rather than
          # silently fall back to weaker (or no) rules.
          @source = :console
          raise Rules::InvalidConfig, 'rules store unavailable, try again shortly'
        end

        @source = :file
        load_rules_file
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

      def valid_approvals(rules)
        approvals = merge_request.approvals.includes(:user).to_a
        return approvals unless rules.reset_on_push

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
      end

      def excluded_user_ids(rules)
        ids = Set.new
        ids << merge_request.author_id unless rules.author_can_approve
        ids.merge(merge_request.committer_ids_to_filter_from_approvers.map(&:id)) unless rules.committers_can_approve
        ids
      end

      def changed_paths
        merge_request.modified_paths(fallback_on_overflow: true)
      end

      # Users who may approve at all are already limited by GitLab's own
      # :approve_merge_request permission (checked when the approval is given).
      def eligible?(rule, user)
        return true if rule.any_approver?
        return true if rule.users.include?(user.username)

        rule.groups.any? { |path| group(path)&.member?(user) }
      end

      def group(path)
        @groups ||= {}
        return @groups[path] if @groups.key?(path)

        @groups[path] = ::Group.find_by_full_path(path)
      end
    end
  end
end
