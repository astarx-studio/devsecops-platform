# frozen_string_literal: true

module Dsoaas
  module Approvals
    # EE-compatible REST API for approval rules, added to CE's own
    # API::MergeRequestApprovals class the same way GitLab EE extends it (DSL added
    # before API::API mounts the class), so it inherits GitLab's authentication,
    # helpers, rate limits and error handling.
    #
    #   GET|POST            /projects/:id/approval_rules
    #   GET|PUT|DELETE      /projects/:id/approval_rules/:approval_rule_id
    #   GET|POST            /projects/:id/approvals
    #   GET                 /projects/:id/merge_requests/:merge_request_iid/approval_state
    #   GET (extended)      /projects/:id/merge_requests/:merge_request_iid/approvals
    #
    # Field names follow GitLab EE. Additions: require_all, branches, file_paths
    # (rules); source, state, unsatisfiable, approvals_left (approval_state).
    # protected_branches are branch rules linked by ID (they follow renames);
    # branches are other patterns. Names of existing branch rules sent in
    # `branches` are linked too, so both fields end up the same.
    module RestAPI
      ELIGIBLE_LIMIT = 100

      # Shared presenters, kept out of the Grape class so they're plain Ruby.
      module Presenters
        module_function

        def users(list, current_user)
          ::API::Entities::UserBasic.represent(list, current_user: current_user)
        end

        def groups(list)
          ::API::Entities::BasicGroupDetails.represent(list)
        end

        def project_rule(row, project, current_user)
          user_list = ::User.where(id: row['user_ids']).order(:username).to_a
          group_list = ::Group.where(id: row['group_ids']).to_a
          all_protected = row['applies_to_all_protected_branches'] == true
          targets = ::Dsoaas::Approvals::RuleTargets.resolve(project, row)

          member_ids = group_list.flat_map { |g| g.members_with_parents.pluck(:user_id) }
          eligible = (user_list + ::User.active.where(id: member_ids - user_list.map(&:id)).limit(ELIGIBLE_LIMIT).to_a)
            .first(ELIGIBLE_LIMIT)

          {
            id: row['id'],
            name: row['name'],
            rule_type: 'regular',
            report_type: nil,
            eligible_approvers: users(eligible, current_user),
            approvals_required: row['approvals_required'],
            users: users(user_list, current_user),
            groups: groups(group_list),
            contains_hidden_groups: false,
            protected_branches: ::API::Entities::ProtectedBranch.represent(targets.linked),
            applies_to_all_protected_branches: all_protected,
            require_all: row['require_all'] == true,
            branches: targets.patterns,
            file_paths: Array(row['paths'])
          }
        end

        def project_settings(settings)
          {
            approvers: [],
            approver_groups: [],
            approvals_before_merge: 0,
            reset_approvals_on_push: settings['reset_approvals_on_push'],
            disable_overriding_approvers_per_merge_request: true,
            merge_requests_author_approval: settings['merge_requests_author_approval'],
            merge_requests_disable_committers_approval: settings['merge_requests_disable_committers_approval'],
            require_password_to_approve: false,
            require_reauthentication_to_approve: false
          }
        end

        def approval_state(result, current_user)
          {
            approval_rules_overwritten: false,
            source: result.source,
            state: result.state,
            error: result.error,
            approvals_required: result.approvals_required,
            approvals_left: result.approvals_left,
            rules: Array(result.rule_results).map do |r|
              {
                id: r.id,
                name: r.name,
                rule_type: r.rule_type,
                approvals_required: r.required,
                approvals_left: r.approvals_left,
                approved: r.satisfied?,
                approved_by: users(r.approved_users, current_user),
                eligible_approvers: users(r.eligible_users, current_user),
                users: users(r.listed_users, current_user),
                groups: groups(r.groups),
                contains_hidden_groups: false,
                overridden: false,
                source_rule: nil,
                require_all: r.require_all,
                any_approver: r.any_approver,
                branches: r.branches,
                applies_to_all_protected_branches: r.all_protected,
                file_paths: r.paths,
                unsatisfiable: r.unsatisfiable
              }
            end
          }
        end
      end

      # Memoized per MR object within a request (the entity asks three times).
      def self.result_for(merge_request)
        merge_request.instance_variable_get(:@dsoaas_approval_result) ||
          merge_request.instance_variable_set(:@dsoaas_approval_result, Evaluator.new(merge_request).call)
      end

      def self.install!
        api = ::API::MergeRequestApprovals
        return if api.instance_variable_get(:@dsoaas_approvals_api)

        api.instance_variable_set(:@dsoaas_approvals_api, true)
        api.class_eval(&ENDPOINTS)
        extend_entity!
      end

      # EE's extra fields on GET /merge_requests/:iid/approvals.
      def self.extend_entity!
        entity = ::API::Entities::MergeRequestApprovals
        return if entity.root_exposures.any? { |e| e.key == :approvals_left }

        entity.class_eval do
          expose :approvals_required, documentation: { type: 'Integer' } do |merge_request|
            ::Dsoaas::Approvals::RestAPI.result_for(merge_request).approvals_required
          end
          expose :approvals_left, documentation: { type: 'Integer' } do |merge_request|
            ::Dsoaas::Approvals::RestAPI.result_for(merge_request).approvals_left
          end
          expose :approval_rules_left do |merge_request|
            Array(::Dsoaas::Approvals::RestAPI.result_for(merge_request).rule_results)
              .reject(&:satisfied?).map { |r| { id: r.id, name: r.name, rule_type: r.rule_type } }
          end
        end
      end

      ENDPOINTS = proc do
        helpers do
          def dsoaas_rules
            @dsoaas_rules ||= ::Dsoaas::Approvals::RuleService.new(user_project, current_user)
          end

          def dsoaas_handle
            yield
          rescue ::Dsoaas::Approvals::RuleService::ValidationError => e
            render_api_error!(e.message, 400)
          rescue ::Dsoaas::PluginDB::Unavailable => e
            render_api_error!("Approval rules are unavailable: #{e.message}", 503)
          rescue ActiveRecord::RecordNotFound
            not_found!('Approval rule')
          end

          def dsoaas_rule_params
            declared_params(include_missing: false)
          end

          def dsoaas_present_rule(row)
            present ::Dsoaas::Approvals::RestAPI::Presenters.project_rule(row, user_project, current_user)
          end

          params :dsoaas_rule_fields do
            optional :approvals_required, type: Integer, desc: 'Approvals needed (ignored with require_all)'
            optional :require_all, type: Grape::API::Boolean, desc: 'Every listed user must approve'
            optional :user_ids, type: Array[Integer], desc: 'Eligible (or, with require_all, required) users'
            optional :usernames, type: Array[String], desc: 'Same as user_ids, by username'
            optional :group_ids, type: Array[Integer], desc: 'Groups whose members are eligible'
            optional :protected_branch_ids, type: Array[Integer], desc: 'Limit to these protected branches'
            optional :applies_to_all_protected_branches, type: Grape::API::Boolean
            optional :branches, type: Array[String], desc: 'Limit to target branches matching these patterns'
            optional :file_paths, type: Array[String], desc: 'Apply only when these paths change'
          end
        end

        params do
          requires :id, types: [String, Integer], desc: 'ID or URL-encoded path of the project'
        end
        resource :projects, requirements: ::API::NAMESPACE_OR_PROJECT_REQUIREMENTS do
          desc 'List approval rules of a project' do
            success code: 200
          end
          get ':id/approval_rules', urgency: :low do
            authorize! :read_merge_request, user_project
            dsoaas_handle do
              present dsoaas_rules.rules.map { |row|
                ::Dsoaas::Approvals::RestAPI::Presenters.project_rule(row, user_project, current_user)
              }
            end
          end

          desc 'Create an approval rule'
          params do
            requires :name, type: String
            use :dsoaas_rule_fields
          end
          post ':id/approval_rules', urgency: :low do
            authorize! :admin_project, user_project
            dsoaas_handle do
              status 201
              dsoaas_present_rule(dsoaas_rules.create(dsoaas_rule_params))
            end
          end

          desc 'Get an approval rule'
          params do
            requires :approval_rule_id, type: Integer
          end
          get ':id/approval_rules/:approval_rule_id', urgency: :low do
            authorize! :read_merge_request, user_project
            dsoaas_handle do
              row = dsoaas_rules.find(params[:approval_rule_id]) or not_found!('Approval rule')
              dsoaas_present_rule(row)
            end
          end

          desc 'Update an approval rule'
          params do
            requires :approval_rule_id, type: Integer
            optional :name, type: String
            use :dsoaas_rule_fields
          end
          put ':id/approval_rules/:approval_rule_id', urgency: :low do
            authorize! :admin_project, user_project
            dsoaas_handle do
              attrs = dsoaas_rule_params.except(:approval_rule_id)
              dsoaas_present_rule(dsoaas_rules.update(params[:approval_rule_id], attrs))
            end
          end

          desc 'Delete an approval rule'
          params do
            requires :approval_rule_id, type: Integer
          end
          delete ':id/approval_rules/:approval_rule_id', urgency: :low do
            authorize! :admin_project, user_project
            dsoaas_handle do
              dsoaas_rules.destroy(params[:approval_rule_id])
              no_content!
            end
          end

          desc 'Get approval settings of a project'
          get ':id/approvals', urgency: :low do
            authorize! :read_merge_request, user_project
            dsoaas_handle do
              present ::Dsoaas::Approvals::RestAPI::Presenters.project_settings(dsoaas_rules.settings)
            end
          end

          desc 'Change approval settings of a project'
          params do
            optional :merge_requests_author_approval, type: Grape::API::Boolean
            optional :merge_requests_disable_committers_approval, type: Grape::API::Boolean
            optional :reset_approvals_on_push, type: Grape::API::Boolean
          end
          post ':id/approvals', urgency: :low do
            authorize! :admin_project, user_project
            dsoaas_handle do
              status 201
              values = dsoaas_rules.update_settings(dsoaas_rule_params)
              present ::Dsoaas::Approvals::RestAPI::Presenters.project_settings(values)
            end
          end

          desc 'Get the approval state of a merge request'
          params do
            requires :merge_request_iid, type: Integer
          end
          get ':id/merge_requests/:merge_request_iid/approval_state', urgency: :low do
            merge_request = find_merge_request_with_access(params[:merge_request_iid])
            result = ::Dsoaas::Approvals::RestAPI.result_for(merge_request)
            present ::Dsoaas::Approvals::RestAPI::Presenters.approval_state(result, current_user)
          end
        end
      end
    end
  end
end
