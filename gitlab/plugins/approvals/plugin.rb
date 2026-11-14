# frozen_string_literal: true

# Manifest for the approvals plugin: EE-style merge request approval rules on
# GitLab CE.
#
# Enforcement (core): MergeRequest.mergeable_state_checks_by_tier, the same class
# method GitLab EE overrides to add its approval check.
#
# UI and API (extras), each through a hook GitLab EE itself uses:
#   - Settings > Merge requests: CE renders the partial
#     projects/settings/merge_requests/_merge_request_approvals_settings if it
#     exists (render_if_exists), so we ship it in views/;
#   - REST API: endpoints added to CE's API::MergeRequestApprovals before
#     API::API mounts it (EE does the same via prepend_mod);
#   - MR page: a Rack middleware adds the widget script (no view hook exists).
# Extras fail independently: if one breaks, enforcement keeps working.

require_relative 'rules'
require_relative 'assets'
require_relative 'middleware'

# Middleware must be registered while initializers run (before the stack is
# built). It passes everything through until the plugin has installed.
Rails.application.config.middleware.insert_after(ActionDispatch::ContentSecurityPolicy::Middleware,
  Dsoaas::Approvals::Middleware)

module Dsoaas
  module Approvals
    DIR = __dir__

    # Prepended onto MergeRequest's singleton class.
    module MergeRequestChecks
      def mergeable_state_checks_by_tier
        tiers = super.dup
        check = ::Dsoaas::Approvals::CheckApprovalRulesService
        # Reads a repository blob, so it belongs with the other heavy checks.
        tiers[:heavy] = [*tiers[:heavy], check] unless Array(tiers[:heavy]).include?(check)
        tiers
      end
    end

    module Plugin
      class << self
        def name
          'approvals'
        end

        # Reviewed against this range. Outside it the loader skips the plugin
        # (GitLab keeps running as stock CE) until someone re-verifies the seams.
        def supported
          ['>= 19.5', '< 20.0']
        end

        def compatible?
          return [false, 'GitLab EE detected; EE has its own approval check'] if Gitlab.ee?
          return [false, 'MergeRequest.mergeable_state_checks_by_tier missing'] unless
            ::MergeRequest.respond_to?(:mergeable_state_checks_by_tier)
          return [false, 'CheckBaseService.set_identifier missing'] unless
            ::MergeRequests::Mergeability::CheckBaseService.respond_to?(:set_identifier)

          taken = ::MergeRequest.all_mergeability_checks.find do |c|
            c.identifier.to_s == 'not_approved' && c.name != 'Dsoaas::Approvals::CheckApprovalRulesService'
          end
          return [false, "identifier not_approved already used by #{taken}"] if taken

          [true, nil]
        end

        def install!
          load_file('rules_store.rb')
          load_file('evaluator.rb')
          load_file('feedback.rb')
          load_file('check_approval_rules_service.rb')
          load_file('rule_service.rb')

          Dsoaas::PluginDB.register_migrations(name, File.join(DIR, 'migrations'))

          unless ::MergeRequest.singleton_class.ancestors.include?(MergeRequestChecks)
            ::MergeRequest.singleton_class.prepend(MergeRequestChecks)
          end

          install_extras!
        end

        # name => :installed or "error message"; checked by the contract test.
        def extras
          @extras ||= {}
        end

        # Runs during initializers (see the loader): the REST endpoints must be in
        # CE's API class before API::API mounts it and its routes are memoized.
        def early_install!
          extra(:rest_api) do
            load_file('api.rb')
            Dsoaas::Approvals::RestAPI.install!
          end
        end

        private

        def install_extras!
          early_install! unless extras[:rest_api] == :installed
          extra(:settings_ui) do
            views = File.join(DIR, 'views')
            ::ActionController::Base.prepend_view_path(views) unless ::ActionController::Base.view_paths.map(&:to_s).include?(views)
          end
          extra(:mr_widget) do
            missing = %w[mr_widget.js settings.js approvals.css].reject { |f| Assets.present?(f) }
            raise "assets missing: #{missing.join(', ')}" if missing.any?
          end
        end

        def extra(key)
          yield
          extras[key] = :installed
        rescue StandardError, ScriptError => e
          extras[key] = "#{e.class}: #{e.message}"
          Rails.logger.error("dsoaas plugin approvals extra #{key} failed: #{extras[key]}")
          warn("[dsoaas] approvals extra #{key} failed: #{extras[key]}")
        end

        # `load` (not require) so a dev-mode reload rebinds to the fresh
        # CheckBaseService constant; in production to_prepare runs once.
        def load_file(file)
          load File.join(DIR, file)
        end
      end
    end
  end
end

Dsoaas::Plugins.register(Dsoaas::Approvals::Plugin)
