# frozen_string_literal: true

require 'json'

module Dsoaas
  module Approvals
    # The only write path for native approval rules and approval settings. Used by
    # the EE-compatible REST API, which the settings UI calls too.
    #
    # Validates input (users, groups, protected branches must exist; rules must be
    # satisfiable in this project), writes to the plugin database in one
    # transaction together with an audit event, then expires the rules cache so
    # the next mergeability check sees the change.
    class RuleService
      class ValidationError < StandardError; end

      MAX_RULES = 50
      MAX_LIST = 100
      SETTINGS_KEYS = %w[merge_requests_author_approval merge_requests_disable_committers_approval
        reset_approvals_on_push].freeze

      attr_reader :project, :current_user

      def initialize(project, current_user)
        @project = project
        @current_user = current_user
      end

      def entry
        @entry ||= RulesStore.fetch!(project.id)
      end

      def rules
        entry.rules
      end

      def settings
        entry.settings
      end

      def find(id)
        rules.find { |row| row['id'].to_i == id.to_i }
      end

      def create(params)
        raise ValidationError, "a project can have at most #{MAX_RULES} approval rules" if rules.size >= MAX_RULES

        attrs = normalize(params, existing: nil)
        write('rule.created') do |conn|
          conn.exec_params(<<~SQL, row_params(attrs)).first['row']
            INSERT INTO dsoaas_approval_rules
              (project_id, name, approvals_required, require_all, user_ids, group_ids, branches,
               applies_to_all_protected_branches, paths, protected_branches)
            VALUES ($1, $2, $3, $4, $5::bigint[], $6::bigint[], $7::text[], $8, $9::text[], $10::jsonb)
            RETURNING to_jsonb(dsoaas_approval_rules)::text AS row
          SQL
        end
      end

      def update(id, params)
        existing = find(id) or raise ActiveRecord::RecordNotFound, 'approval rule not found'

        attrs = normalize(params, existing: existing)
        write('rule.updated', rule_id: existing['id']) do |conn|
          conn.exec_params(<<~SQL, row_params(attrs) + [existing['id']]).first['row']
            UPDATE dsoaas_approval_rules
               SET name = $2, approvals_required = $3, require_all = $4, user_ids = $5::bigint[],
                   group_ids = $6::bigint[], branches = $7::text[], applies_to_all_protected_branches = $8,
                   paths = $9::text[], protected_branches = $10::jsonb, updated_at = now()
             WHERE project_id = $1 AND id = $11
            RETURNING to_jsonb(dsoaas_approval_rules)::text AS row
          SQL
        end
      end

      def destroy(id)
        existing = find(id) or raise ActiveRecord::RecordNotFound, 'approval rule not found'

        write('rule.deleted', rule_id: existing['id'], snapshot: existing) do |conn|
          conn.exec_params('DELETE FROM dsoaas_approval_rules WHERE project_id = $1 AND id = $2',
            [project.id, existing['id']])
          existing.to_json
        end
      end

      def update_settings(params)
        values = settings.merge(params.to_h.stringify_keys.slice(*SETTINGS_KEYS).transform_values { |v| bool(v) })
        write('settings.updated', snapshot: values) do |conn|
          conn.exec_params(<<~SQL, [project.id, *SETTINGS_KEYS.map { |k| values[k] }, current_user&.id])
            INSERT INTO dsoaas_approval_project_settings
              (project_id, merge_requests_author_approval, merge_requests_disable_committers_approval,
               reset_approvals_on_push, updated_by_id, updated_at)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (project_id) DO UPDATE
              SET merge_requests_author_approval = EXCLUDED.merge_requests_author_approval,
                  merge_requests_disable_committers_approval = EXCLUDED.merge_requests_disable_committers_approval,
                  reset_approvals_on_push = EXCLUDED.reset_approvals_on_push,
                  updated_by_id = EXCLUDED.updated_by_id, updated_at = now()
          SQL
          values.to_json
        end
      end

      private

      # Merges params over the existing rule (PUT is partial, as in EE) and validates.
      def normalize(params, existing:)
        params = params.to_h.stringify_keys
        base = existing || {}

        name = (params.key?('name') ? params['name'] : base['name']).to_s.strip
        raise ValidationError, 'name is required' if name.empty?
        raise ValidationError, 'name is too long (maximum 200 characters)' if name.length > 200
        if rules.any? { |r| r['name'] == name && r['id'] != base['id'] }
          raise ValidationError, "name has already been taken: #{name}"
        end

        require_all = params.key?('require_all') ? bool(params['require_all']) : base['require_all'] == true
        user_ids = params.key?('user_ids') || params.key?('usernames') ? resolve_users(params) : Array(base['user_ids'])
        group_ids = params.key?('group_ids') ? resolve_groups(params['group_ids']) : Array(base['group_ids'])

        links, branches = if params.key?('protected_branch_ids') || params.key?('branches')
                            resolve_branches(params)
                          else
                            current = RuleTargets.resolve(project, base) # refreshes names; stale links become patterns
                            [current.linked.to_h { |pb| [pb.id.to_s, pb.name] }, current.patterns]
                          end
        all_protected = if params.key?('applies_to_all_protected_branches')
                          bool(params['applies_to_all_protected_branches'])
                        else
                          base['applies_to_all_protected_branches'] == true
                        end
        if all_protected
          links = {}
          branches = []
        end
        paths = params.key?('file_paths') ? string_list(params['file_paths'], 'file_paths') : Array(base['paths'])

        approvals_required =
          if require_all
            raise ValidationError, 'require_all needs at least one user' if user_ids.empty?
            raise ValidationError, "require_all can't be used with groups" if group_ids.any?

            user_ids.size
          else
            value = params.key?('approvals_required') ? params['approvals_required'] : base['approvals_required']
            Integer(value || 0)
          end
        raise ValidationError, 'approvals_required must be between 0 and 100' unless approvals_required.between?(0, 100)

        check_satisfiable!(require_all, user_ids, group_ids, approvals_required)

        { name: name, approvals_required: approvals_required, require_all: require_all, user_ids: user_ids,
          group_ids: group_ids, branches: branches, links: links, all_protected: all_protected, paths: paths }
      rescue ArgumentError, TypeError
        raise ValidationError, 'ids and approvals_required must be integers'
      end

      def resolve_users(params)
        ids = Array(params['user_ids']).map { |v| Integer(v) }
        names = Array(params['usernames']).map { |n| n.to_s.strip.delete_prefix('@') }.reject(&:empty?)
        raise ValidationError, "at most #{MAX_LIST} users" if ids.size + names.size > MAX_LIST

        found = ::User.where(id: ids).to_a + (names.empty? ? [] : ::User.by_username(names).to_a)
        missing_ids = ids - found.map(&:id)
        missing_names = names.map(&:downcase) - found.map { |u| u.username.downcase }
        missing = missing_ids.map { |id| "##{id}" } + missing_names
        raise ValidationError, "user not found: #{missing.join(', ')}" if missing.any?

        inactive = found.reject(&:active?)
        raise ValidationError, "user is not active: #{inactive.map(&:username).join(', ')}" if inactive.any?

        found.map(&:id).uniq
      end

      def resolve_groups(values)
        ids = Array(values).map { |v| Integer(v) }.uniq
        raise ValidationError, "at most #{MAX_LIST} groups" if ids.size > MAX_LIST

        groups = ::Group.where(id: ids).to_a
        missing = ids - groups.map(&:id)
        raise ValidationError, "group not found: #{missing.map { |id| "##{id}" }.join(', ')}" if missing.any?

        hidden = groups.reject { |g| Ability.allowed?(current_user, :read_group, g) }
        raise ValidationError, "group not found: #{hidden.map { |g| "##{g.id}" }.join(', ')}" if hidden.any?

        ids
      end

      # Names of this project's branch rules (and protected_branch_ids) become links
      # that follow renames; anything else is kept as a pattern.
      def resolve_branches(params)
        names = string_list(params['branches'], 'branches')
        raise ValidationError, 'branch patterns must be at most 255 characters' if names.any? { |b| b.length > 255 }

        ids = Array(params['protected_branch_ids']).map { |v| Integer(v) }.uniq
        links, patterns, missing = RuleTargets.split(project, names, ids)
        raise ValidationError, "protected branch not found: #{missing.join(', ')}" if missing.any?

        [links, patterns]
      end

      def string_list(value, label)
        list = Array(value).map { |v| v.to_s.strip }.reject(&:empty?).uniq
        raise ValidationError, "at most #{MAX_LIST} #{label}" if list.size > MAX_LIST

        list
      end

      # Refuses rules that can never be met in this project. The per-MR author and
      # committer exclusions are checked by the evaluator (they depend on the MR).
      def check_satisfiable!(require_all, user_ids, group_ids, approvals_required)
        developers = ::ProjectAuthorization.where(project_id: project.id)
          .where('access_level >= ?', ::Gitlab::Access::DEVELOPER).pluck(:user_id)

        if require_all
          unable = ::User.where(id: user_ids - developers).pluck(:username)
          if unable.any?
            raise ValidationError,
              "#{unable.join(', ')} can't approve merge requests in this project (needs the Developer role or higher)"
          end
          return
        end

        return if approvals_required.zero?

        pool = if user_ids.empty? && group_ids.empty?
                 developers
               else
                 members = group_ids.flat_map { |gid| ::Group.find(gid).members_with_parents.pluck(:user_id) }
                 (user_ids | members) & developers
               end
        possible = ::User.active.where(id: pool).count
        return if possible >= approvals_required

        raise ValidationError,
          "needs #{approvals_required} approvals, but only #{possible} of the selected approvers can approve " \
          'merge requests in this project (Developer role or higher)'
      end

      def bool(value)
        ActiveModel::Type::Boolean.new.cast(value) == true
      end

      def row_params(attrs)
        enc = PG::TextEncoder::Array.new
        [project.id, attrs[:name], attrs[:approvals_required], attrs[:require_all],
          enc.encode(attrs[:user_ids]), enc.encode(attrs[:group_ids]), enc.encode(attrs[:branches]),
          attrs[:all_protected], enc.encode(attrs[:paths]), attrs[:links].to_json]
      end

      # Runs the write and its audit event in one transaction; returns the parsed row.
      def write(action, rule_id: nil, snapshot: nil)
        json = Dsoaas::PluginDB.with! do |conn|
          conn.transaction do |tx|
            result = yield(tx)
            data = result.is_a?(String) ? JSON.parse(result) : {}
            tx.exec_params(<<~SQL, [project.id, current_user&.id, action, rule_id || data['id'], (snapshot || data).to_json])
              INSERT INTO dsoaas_approval_rule_events (project_id, user_id, action, rule_id, snapshot)
              VALUES ($1, $2, $3, $4, $5::jsonb)
            SQL
            result
          end
        end
        RulesStore.expire(project.id)
        @entry = nil
        json.is_a?(String) ? JSON.parse(json) : json
      rescue PG::UniqueViolation
        raise ValidationError, 'name has already been taken'
      rescue PG::CheckViolation => e
        raise ValidationError, e.message.lines.first.to_s.strip
      end
    end
  end
end
