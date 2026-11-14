# frozen_string_literal: true

require 'json'

module Dsoaas
  module Approvals
    # Static assets (assets/*) are copied by gitlab/Dockerfile to
    # public/assets/dsoaas/<name>-<sha>.<ext>, where GitLab serves /assets/ itself.
    # The content hash in the file name makes long browser caching safe.
    module Assets
      MANIFEST = File.join(__dir__, 'assets-manifest.json')

      class << self
        def path(name)
          file = manifest.fetch(name, name)
          "#{relative_url_root}/assets/dsoaas/#{file}"
        end

        def manifest
          @manifest ||= File.exist?(MANIFEST) ? JSON.parse(File.read(MANIFEST)) : {}
        end

        def present?(name)
          manifest.key?(name) && File.exist?(public_file(manifest[name]))
        end

        def public_file(file)
          File.expand_path("../../public/assets/dsoaas/#{file}", __dir__)
        end

        private

        def relative_url_root
          root = defined?(Gitlab) && Gitlab.respond_to?(:config) ? Gitlab.config.gitlab.relative_url_root.to_s : ''
          root.chomp('/')
        end
      end
    end
  end
end
