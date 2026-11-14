# frozen_string_literal: true

module Dsoaas
  module Approvals
    # Mergeability check appended to MergeRequest.mergeable_state_checks_by_tier.
    #
    # Uses GitLab's existing `not_approved` identifier, which CE never emits on its
    # own. The merge widget, the REST `detailed_merge_status` field and the GraphQL
    # enums all already know it ("All required approvals must be given."), so no
    # frontend changes are needed.
    class CheckApprovalRulesService < ::MergeRequests::Mergeability::CheckBaseService
      set_identifier :not_approved
      set_description 'Checks whether the merge request satisfies the approval rules in .gitlab/approvals.yml'
      set_failure_explanation('All required approvals must be given.') if respond_to?(:set_failure_explanation)

      def execute
        result = Evaluator.new(merge_request).call
        Feedback.after_evaluation(merge_request, result)

        case result.state
        when :inactive then inactive
        when :passed then success
        else failure
        end
      rescue StandardError => e
        # Fail closed: a plugin bug must never silently allow a merge.
        Gitlab::ErrorTracking.track_exception(e, dsoaas_plugin: 'approvals', merge_request_id: merge_request.id)
        failure
      end

      # Same semantics as EE's approval check: auto-merge "when checks pass" may be
      # *scheduled* without approvals; the real merge re-runs this check unskipped.
      def skip?
        params[:skip_approved_check].present?
      end

      def cacheable?
        false
      end
    end
  end
end
