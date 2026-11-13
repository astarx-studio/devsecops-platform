# frozen_string_literal: true

# Manifest for the approvals plugin: enforced merge request approval rules
# on GitLab CE, configured per repository in `.gitlab/approvals.yml`.
#
# Seam: MergeRequest.mergeable_state_checks_by_tier, the same class method
# GitLab EE overrides to add its approval check. Prepending one check here is the
# plugin's only change to GitLab's behaviour.

require_relative 'rules'

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

          Dsoaas::PluginDB.register_migrations(name, File.join(DIR, 'migrations'))

          return if ::MergeRequest.singleton_class.ancestors.include?(MergeRequestChecks)

          ::MergeRequest.singleton_class.prepend(MergeRequestChecks)
        end

        private

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
