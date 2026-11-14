# frozen_string_literal: true

# DSOaaS plugin loader for GitLab CE.
#
# Added by the platform image (gitlab/Dockerfile); not part of GitLab itself.
# Contract with GitLab:
#   - additive only: plugins prepend into a small set of documented seams
#     (listed in /opt/dsoaas/seams.txt) and never edit GitLab files;
#   - no schema changes to GitLab's database: plugin state goes to the separate
#     database in DSOAAS_PLUGINS_DB_URL (see dsoaas_plugins/_core/plugin_db.rb);
#   - fail-open on install: an incompatible plugin is skipped and logged,
#     GitLab keeps booting as stock CE.
#
# Each plugin lives in dsoaas_plugins/<name>/plugin.rb and calls
# Dsoaas::Plugins.register with an object responding to:
#   name        -> String
#   supported   -> Gem::Requirement string for Gitlab::VERSION, e.g. ">= 19.5, < 20.0"
#   compatible? -> [Boolean, reason]   (runtime seam check, called after autoload is ready)
#   install!    -> prepends; must be idempotent
#
# Inspect from a shell:
#   gitlab-rails runner 'pp Dsoaas::Plugins.statuses'

module Dsoaas
  module Plugins
    ROOT = File.expand_path('../../dsoaas_plugins', __dir__)

    Status = Struct.new(:name, :state, :reason, keyword_init: true)

    @registry = []
    @statuses = {}

    class << self
      attr_reader :statuses

      def register(plugin)
        @registry << plugin unless @registry.any? { |p| p.name == plugin.name }
      end

      def plugins
        @registry.dup
      end

      def install_all!
        @registry.each { |plugin| install(plugin) }
      end

      # Optional `early_install!` hook, run while initializers run (before the
      # middleware stack is built and before to_prepare). Needed for Grape: under
      # Puma, GitLab's request-metrics middleware memoizes API::API.routes when the
      # stack is built, so endpoints must be added before that. Same version gate
      # as install; errors are logged and never stop GitLab from booting.
      def early_install_all!
        @registry.each do |plugin|
          next unless plugin.respond_to?(:early_install!)

          requirement = Gem::Requirement.new(*Array(plugin.supported))
          next unless requirement.satisfied_by?(Gem::Version.new(Gitlab::VERSION.sub(/-.*/, '')))
          next if Gitlab.ee?

          plugin.early_install!
        rescue StandardError, ScriptError => e
          message = "dsoaas plugin #{plugin.name} early install failed: #{e.class}: #{e.message}"
          Rails.logger.error(message)
          warn("[dsoaas] #{message}")
        end
      end

      def installed?(name)
        @statuses[name.to_s]&.state == :installed
      end

      private

      def install(plugin)
        name = plugin.name.to_s
        return if installed?(name)

        requirement = Gem::Requirement.new(*Array(plugin.supported))
        version = Gem::Version.new(Gitlab::VERSION.sub(/-.*/, ''))
        unless requirement.satisfied_by?(version)
          return record(name, :skipped, "GitLab #{Gitlab::VERSION} outside supported range #{requirement}")
        end

        ok, reason = plugin.compatible?
        return record(name, :skipped, "incompatible: #{reason}") unless ok

        plugin.install!
        record(name, :installed, "GitLab #{Gitlab::VERSION}")
      rescue StandardError, ScriptError => e
        record(name, :failed, "#{e.class}: #{e.message}")
      end

      def record(name, state, reason)
        @statuses[name] = Status.new(name: name, state: state, reason: reason)
        message = "dsoaas plugin #{name} #{state}: #{reason}"
        if state == :installed
          Rails.logger.info(message)
        else
          Rails.logger.error(message)
          warn("[dsoaas] #{message}") # visible in container logs even if Rails logging is quiet
        end
        @statuses[name]
      end
    end
  end
end

# Shared, GitLab-independent helpers (plugin DB) first, then each plugin's manifest.
# Manifests must not reference GitLab app constants at require time; they do that
# inside install!/compatible?, which run in to_prepare once autoloading is ready.
Dir[File.join(Dsoaas::Plugins::ROOT, '_core', '*.rb')].sort.each { |f| require f }
Dir[File.join(Dsoaas::Plugins::ROOT, '*', 'plugin.rb')].sort.each do |manifest|
  require manifest
rescue StandardError, ScriptError => e
  warn("[dsoaas] failed to load #{manifest}: #{e.class}: #{e.message}")
end

Dsoaas::Plugins.early_install_all!

# to_prepare runs before eager loading in production, which matters: GraphQL enums
# such as MergeabilityCheckIdentifierEnum are built from the check list when their
# class loads, so plugin checks must be prepended before that.
Gitlab::Application.config.to_prepare do
  Dsoaas::Plugins.install_all!
end
