# frozen_string_literal: true

require 'pg'
require 'connection_pool'

module Dsoaas
  # The plugins' own PostgreSQL database, kept apart from GitLab's.
  #
  # Isolation rules:
  #   - Raw `pg` connections from DSOAAS_PLUGINS_DB_URL, deliberately NOT
  #     ActiveRecord: GitLab instruments every AR connection (load balancing,
  #     query analyzers, schema validation), and an extra AR database would also
  #     have to be declared in GitLab's gitlab-ctl-managed database.yml. A raw
  #     pool can't touch gitlabhq_production and GitLab's tooling never sees it.
  #   - Plugin migrations live under <plugin>/migrations/: `.sql` files, or `.rb`
  #     files evaluating to a lambda `->(conn) { ... }` for data migrations that
  #     need GitLab models (read-only use). Tracked in dsoaas_schema_migrations in
  #     THIS database; GitLab's db:migrate never runs them.
  #   - Two entry points:
  #       `with`  - best-effort reads/side writes: nil when unset or unreachable,
  #                 and a breaker stops retries for BREAKER_SECONDS;
  #       `with!` - writes a user is waiting for: raises Unavailable instead of
  #                 returning nil, and SQL errors (e.g. a unique violation)
  #                 propagate to the caller instead of tripping the breaker.
  #   - Lazy and fork-safe: no connection is opened at boot (Puma preloads in the
  #     master and forks), and a pool created in another process is discarded.
  module PluginDB
    ENV_URL = 'DSOAAS_PLUGINS_DB_URL'
    BREAKER_SECONDS = 60
    STATEMENT_TIMEOUT = '2s'

    # Connection-level failures (vs. SQL errors such as constraint violations).
    CONNECTION_ERRORS = [PG::ConnectionBad, PG::UnableToSend, ConnectionPool::Error, Timeout::Error,
                         SystemCallError].freeze

    class Unavailable < StandardError; end

    @mutex = Mutex.new
    @migrations = {} # plugin name => migrations dir
    @migrated = false

    class << self
      def configured?
        !ENV[ENV_URL].to_s.strip.empty?
      end

      # Registers a plugin's SQL migrations; they're applied on first use.
      def register_migrations(plugin, dir)
        @mutex.synchronize do
          @migrations[plugin.to_s] = dir
          @migrated = false
        end
      end

      # Yields a PG::Connection, or returns nil when the DB is unavailable.
      def with
        return nil unless configured?
        return nil if tripped?

        ensure_migrated!
        pool.with { |conn| yield conn }
      rescue *CONNECTION_ERRORS => e
        trip!(e)
        nil
      rescue PG::Error => e
        Rails.logger.warn("dsoaas plugin_db query failed: #{e.class}: #{e.message}")
        nil
      end

      # Like `with`, but for writes a user is waiting on: raises Unavailable when
      # the database can't be reached, and lets SQL errors propagate.
      def with!
        raise Unavailable, "#{ENV_URL} is not set" unless configured?
        raise Unavailable, 'plugin database recently unreachable, retrying shortly' if tripped?

        ensure_migrated!
        pool.with { |conn| yield conn }
      rescue *CONNECTION_ERRORS => e
        trip!(e)
        raise Unavailable, "plugin database unreachable: #{e.class}"
      end

      def status
        return { configured: false } unless configured?

        ok = with { |c| c.exec('SELECT 1').getvalue(0, 0) == '1' }
        { configured: true, reachable: ok == true, tripped_until: @tripped_until }
      end

      # Test hook: forget pool, breaker and migration state.
      def reset!
        @mutex.synchronize { drop_pool! }
        @tripped_until = nil
        @migrated = false
      end

      private

      def pool
        @mutex.synchronize do
          drop_pool! if @pool_pid && @pool_pid != Process.pid
          @pool ||= begin
            @pool_pid = Process.pid
            ConnectionPool.new(size: 2, timeout: 1) { connect }
          end
        end
      end

      def connect
        conn = PG.connect(ENV.fetch(ENV_URL), connect_timeout: 2, application_name: 'dsoaas-gitlab-plugins')
        conn.exec("SET statement_timeout = '#{STATEMENT_TIMEOUT}'")
        conn.exec('SET client_min_messages = warning') # no NOTICE noise from IF NOT EXISTS
        conn
      end

      def drop_pool!
        old = @pool
        @pool = nil
        # Only close sockets this process opened; a forked child must not
        # close the parent's connections.
        old&.shutdown { |c| c.close rescue nil } if @pool_pid == Process.pid # rubocop:disable Style/RescueModifier
        @pool_pid = nil
      end

      def tripped?
        @tripped_until && Time.now < @tripped_until
      end

      def trip!(error)
        @tripped_until = Time.now + BREAKER_SECONDS
        @mutex.synchronize { drop_pool! }
        Rails.logger.warn("dsoaas plugin_db unavailable for #{BREAKER_SECONDS}s: #{error.class}: #{error.message}")
      end

      def ensure_migrated!
        return if @migrated

        migrations = @mutex.synchronize { @migrations.dup }
        pool.with { |conn| migrate!(conn, migrations) }
        @migrated = true
      end

      def migrate!(conn, migrations)
        conn.exec(<<~SQL)
          CREATE TABLE IF NOT EXISTS dsoaas_schema_migrations (
            plugin     text        NOT NULL,
            version    text        NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (plugin, version)
          )
        SQL

        # Serialize concurrent first-use across Puma workers and Sidekiq.
        conn.exec("SELECT pg_advisory_lock(hashtext('dsoaas_schema_migrations'))")
        begin
          migrations.each do |plugin, dir|
            applied = conn.exec_params('SELECT version FROM dsoaas_schema_migrations WHERE plugin = $1', [plugin])
                          .column_values(0)
            Dir[File.join(dir, '*.{sql,rb}')].sort_by { |f| File.basename(f) }.each do |file|
              version = File.basename(file, '.*')
              next if applied.include?(version)

              conn.transaction do |tx|
                if file.end_with?('.rb')
                  # rubocop:disable Security/Eval -- our own migration file, shipped in the image
                  migration = Module.new.module_eval(File.read(file), file)
                  # rubocop:enable Security/Eval
                  migration.call(tx)
                else
                  tx.exec(File.read(file))
                end
                tx.exec_params('INSERT INTO dsoaas_schema_migrations (plugin, version) VALUES ($1, $2)', [plugin, version])
              end
              Rails.logger.info("dsoaas plugin_db applied #{plugin}/#{version}")
            end
          end
        ensure
          conn.exec("SELECT pg_advisory_unlock(hashtext('dsoaas_schema_migrations'))")
        end
      end
    end
  end
end
