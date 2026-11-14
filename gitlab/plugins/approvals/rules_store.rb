# frozen_string_literal: true

require 'json'

module Dsoaas
  module Approvals
    # Native approval rules (managed in GitLab's UI and REST API), read from the
    # plugin database, never GitLab's.
    #
    # These rules decide merges, so the lookup must not fail open:
    #   - FRESH_TTL: a short cache so a page with many MRs costs one query; every
    #     write calls `expire`, so a change in the UI applies immediately;
    #   - a long-lived "last known" copy per project, used when the plugin DB is
    #     unreachable;
    #   - neither available -> :unavailable, which the evaluator treats as blocking.
    module RulesStore
      FRESH_TTL = 15.seconds
      LAST_KNOWN_TTL = 30.days

      # state: :found (project has at least one native rule), :none, :unavailable.
      # rules: Array of Hashes (dsoaas_approval_rules columns), settings: Hash.
      Entry = Struct.new(:state, :rules, :settings, :stale, keyword_init: true)

      DEFAULT_SETTINGS = {
        'merge_requests_author_approval' => false,
        'merge_requests_disable_committers_approval' => false,
        'reset_approvals_on_push' => true
      }.freeze

      LOAD_SQL = <<~SQL
        SELECT
          (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
             FROM dsoaas_approval_rules r WHERE r.project_id = $1)::text AS rules,
          (SELECT to_jsonb(s) FROM dsoaas_approval_project_settings s WHERE s.project_id = $1)::text AS settings
      SQL

      class << self
        def fetch(project_id)
          return Entry.new(state: :none, rules: [], settings: DEFAULT_SETTINGS) unless Dsoaas::PluginDB.configured?

          fresh = Rails.cache.read(fresh_key(project_id))
          return decode(fresh) if fresh

          raw = Dsoaas::PluginDB.with { |conn| load_raw(conn, project_id) }
          if raw.nil?
            known = Rails.cache.read(known_key(project_id))
            return known ? decode(known, stale: true) : Entry.new(state: :unavailable, rules: [], settings: DEFAULT_SETTINGS)
          end

          Rails.cache.write(fresh_key(project_id), raw, expires_in: FRESH_TTL)
          Rails.cache.write(known_key(project_id), raw, expires_in: LAST_KNOWN_TTL)
          decode(raw)
        end

        # Strict read for the settings UI and REST API (raises PluginDB::Unavailable).
        def fetch!(project_id)
          decode(Dsoaas::PluginDB.with! { |conn| load_raw(conn, project_id) })
        end

        # Called after every write, so the next evaluation reads the new rules.
        def expire(project_id)
          Rails.cache.delete(fresh_key(project_id))
          Rails.cache.delete(known_key(project_id))
        end

        private

        # Cached as a plain JSON string: no custom classes in the Rails cache.
        def load_raw(conn, project_id)
          row = conn.exec_params(LOAD_SQL, [project_id]).first
          { 'rules' => row['rules'], 'settings' => row['settings'] }.to_json
        end

        def decode(raw, stale: false)
          data = JSON.parse(raw)
          rules = JSON.parse(data['rules'] || '[]')
          settings = DEFAULT_SETTINGS.merge(data['settings'] ? JSON.parse(data['settings']).slice(*DEFAULT_SETTINGS.keys) : {})
          Entry.new(state: rules.any? ? :found : :none, rules: rules, settings: settings, stale: stale)
        rescue JSON::ParserError
          Entry.new(state: :unavailable, rules: [], settings: DEFAULT_SETTINGS, stale: stale)
        end

        def fresh_key(project_id)
          "dsoaas:approvals:native:fresh:#{project_id}"
        end

        def known_key(project_id)
          "dsoaas:approvals:native:known:#{project_id}"
        end
      end
    end
  end
end
