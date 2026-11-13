# frozen_string_literal: true

require 'digest'
require 'json'

module Dsoaas
  module Approvals
    # Side channel after each evaluation, only when the outcome CHANGED:
    #   1. audit row in the plugin database (never GitLab's);
    #   2. optional status note on the MR, posted through GitLab's normal
    #      Notes services as a bot user, edited in place afterwards.
    #
    # Opt-in for the note: it's posted only if the bot user exists
    # (DSOAAS_APPROVALS_BOT_USERNAME, default "dsoaas-approvals") and
    # DSOAAS_APPROVALS_NOTE isn't "false". Nothing here can change the merge
    # decision, and every failure is swallowed and logged.
    module Feedback
      NOTE_MARKER = '<!-- dsoaas-approvals -->'
      LEASE_TIMEOUT = 30
      DIGEST_TTL = 30.days

      class << self
        def after_evaluation(merge_request, result)
          return if result.state == :inactive

          digest = Digest::SHA256.hexdigest([merge_request.diff_head_sha, result.summary].to_json)
          cache_key = "dsoaas:approvals:digest:#{merge_request.id}"
          return if Rails.cache.read(cache_key) == digest

          lease = Gitlab::ExclusiveLease.new("dsoaas:approvals:feedback:#{merge_request.id}", timeout: LEASE_TIMEOUT)
          return unless lease.try_obtain

          begin
            return if Rails.cache.read(cache_key) == digest

            record_audit(merge_request, result, digest)
            upsert_note(merge_request, result)
            Rails.cache.write(cache_key, digest, expires_in: DIGEST_TTL)
          ensure
            lease.cancel
          end
        rescue StandardError => e
          Rails.logger.warn("dsoaas approvals feedback failed for MR #{merge_request&.id}: #{e.class}: #{e.message}")
        end

        def note_body(result)
          origin = result.source == :console ? 'set in the platform console' : '`.gitlab/approvals.yml` on the target branch'
          lines = [NOTE_MARKER, "**Approval rules** (#{origin})", '']
          if result.state == :invalid
            lines << ":x: Approval rules can't be used, so merging is blocked: #{code(result.error)}"
          else
            lines << (result.state == :passed ? ':white_check_mark: All approval rules satisfied.' : ':hourglass: Waiting for approvals.')
            lines << ''
            lines << '| Rule | Approvals | Approved by |'
            lines << '| --- | --- | --- |'
            result.rule_results.each do |r|
              # Everything user-controlled goes in code spans: no @mentions (an edit
              # must not notify anyone), no references, no table breakage.
              who = r.approved_by.any? ? r.approved_by.map { |u| code(u) }.join(', ') : '-'
              icon = r.satisfied? ? ':white_check_mark:' : ':x:'
              lines << "| #{icon} #{code(r.name)} | #{r.approved_by.size}/#{r.required} | #{who} |"
            end
          end
          lines.join("\n")
        end

        def code(text)
          "`#{text.to_s.tr("`|\r\n", "'/  ").strip[0, 300]}`"
        end

        private

        def record_audit(merge_request, result, digest)
          Dsoaas::PluginDB.with do |conn|
            conn.exec_params(<<~SQL, [
              INSERT INTO dsoaas_approval_evaluations
                (project_id, merge_request_id, merge_request_iid, head_sha, state, rules, digest)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
              ON CONFLICT (merge_request_id, digest) DO NOTHING
            SQL
              merge_request.target_project_id, merge_request.id, merge_request.iid,
              merge_request.diff_head_sha, result.state.to_s,
              result.summary[:rules].to_json, digest
            ])
          end
        end

        def upsert_note(merge_request, result)
          return if ENV['DSOAAS_APPROVALS_NOTE'].to_s.downcase == 'false'

          bot = ::User.find_by_username(ENV.fetch('DSOAAS_APPROVALS_BOT_USERNAME', 'dsoaas-approvals'))
          return unless bot&.active?

          body = note_body(result)
          project = merge_request.target_project
          existing = merge_request.notes.where(author_id: bot.id, system: false)
                                  .where('note LIKE ?', "#{NOTE_MARKER}%").order(:id).first

          if existing
            return if existing.note == body

            ::Notes::UpdateService.new(project, bot, note: body).execute(existing)
          else
            ::Notes::CreateService.new(project, bot, noteable: merge_request, note: body).execute
          end
        end
      end
    end
  end
end
