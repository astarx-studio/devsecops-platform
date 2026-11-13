# frozen_string_literal: true

require 'json'

module Dsoaas
  module Approvals
    # Console-managed rules, read from the plugin database (never GitLab's).
    #
    # Unlike the audit trail, these rules decide merges, so the lookup must not
    # fail open:
    #   - FRESH_TTL: a short cache so a page with many MRs costs one query, while
    #     a console change still applies within seconds;
    #   - a long-lived "last known" copy per project, used when the plugin DB is
    #     unreachable;
    #   - neither available -> :unavailable, which the evaluator treats as blocking.
    module RulesStore
      FRESH_TTL = 15.seconds
      LAST_KNOWN_TTL = 30.days

      Entry = Struct.new(:state, :config, :stale, keyword_init: true)

      class << self
        # state: :found (config is a Hash), :none (no console rules for this
        # project), or :unavailable.
        def fetch(project_id)
          return Entry.new(state: :none) unless Dsoaas::PluginDB.configured?

          fresh = Rails.cache.read(fresh_key(project_id))
          return to_entry(fresh) if fresh

          rows = Dsoaas::PluginDB.with do |conn|
            conn.exec_params(
              'SELECT config::text AS config FROM dsoaas_approval_rule_sets WHERE project_id = $1', [project_id]
            ).to_a
          end

          if rows.nil?
            known = Rails.cache.read(known_key(project_id))
            return known ? to_entry(known, stale: true) : Entry.new(state: :unavailable)
          end

          cached = rows.empty? ? { 'state' => 'none' } : { 'state' => 'found', 'config' => rows.first['config'] }
          Rails.cache.write(fresh_key(project_id), cached, expires_in: FRESH_TTL)
          Rails.cache.write(known_key(project_id), cached, expires_in: LAST_KNOWN_TTL)
          to_entry(cached)
        end

        # Test hook.
        def expire(project_id)
          Rails.cache.delete(fresh_key(project_id))
          Rails.cache.delete(known_key(project_id))
        end

        private

        # Cached as plain strings (JSON text), parsed on read: no custom classes
        # in the Rails cache.
        def to_entry(cached, stale: false)
          return Entry.new(state: :none, stale: stale) unless cached['state'] == 'found'

          Entry.new(state: :found, config: JSON.parse(cached['config']), stale: stale)
        rescue JSON::ParserError
          Entry.new(state: :found, config: nil, stale: stale)
        end

        def fresh_key(project_id)
          "dsoaas:approvals:rules:fresh:#{project_id}"
        end

        def known_key(project_id)
          "dsoaas:approvals:rules:known:#{project_id}"
        end
      end
    end
  end
end
