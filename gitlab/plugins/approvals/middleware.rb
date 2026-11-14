# frozen_string_literal: true

require 'erb'

module Dsoaas
  module Approvals
    # Adds the approvals widget script to merge request pages.
    #
    # The MR page has no EE view hook for the approvals widget (it's a compiled
    # Vue app), so the script is appended before </body> of HTML GET responses
    # for /<project>/-/merge_requests/<iid>[/tab]. Everything else passes through
    # untouched. Inserted after Rails' CSP middleware, so it sees the request's
    # CSP nonce (if GitLab generated one) and reuses it.
    class Middleware
      MR_PATH = %r{\A/(?<project>.+?)/-/merge_requests/(?<iid>\d+)(?:/(?:diffs|commits|pipelines|reports))?/?\z}
      NONCE_KEY = 'action_dispatch.content_security_policy_nonce'

      def initialize(app)
        @app = app
      end

      def call(env)
        status, headers, body = @app.call(env)

        match = begin
          candidate(env, status, headers)
        rescue StandardError => e
          log(e)
          nil
        end
        return [status, headers, body] unless match

        html = +''
        body.each { |chunk| html << chunk }
        body.close if body.respond_to?(:close)

        begin
          index = html.rindex('</body>')
          if index
            html.insert(index, tags(env, match))
            %w[content-length Content-Length].each { |k| headers[k] = html.bytesize.to_s if headers.key?(k) }
          end
        rescue StandardError => e
          log(e) # never break a page because of the widget
        end
        [status, headers, [html]]
      end

      private

      def log(error)
        Rails.logger.warn("dsoaas approvals middleware: #{error.class}: #{error.message}")
      end

      def candidate(env, status, headers)
        return unless status == 200 && env['REQUEST_METHOD'] == 'GET'
        return unless Dsoaas::Plugins.installed?('approvals')
        return unless Dsoaas::Approvals::Plugin.extras[:mr_widget] == :installed

        type = headers['content-type'] || headers['Content-Type']
        return unless type.to_s.start_with?('text/html')
        return if headers['content-encoding'] || headers['Content-Encoding']

        root = relative_url_root
        path = env['PATH_INFO'].to_s
        path = path.delete_prefix(root) if root.present? && path.start_with?(root)
        path.match(MR_PATH)
      end

      def tags(env, match)
        nonce = env[NONCE_KEY]
        nonce_attr = nonce ? %( nonce="#{ERB::Util.html_escape(nonce)}") : ''
        project = ERB::Util.html_escape(match[:project])
        css = ERB::Util.html_escape(Assets.path('approvals.css'))
        js = ERB::Util.html_escape(Assets.path('mr_widget.js'))
        %(<link rel="stylesheet" href="#{css}">) +
          %(<script src="#{js}" defer data-dsoaas-approvals data-project="#{project}" ) +
          %(data-iid="#{match[:iid].to_i}" data-api-root="#{ERB::Util.html_escape(relative_url_root)}/api/v4"#{nonce_attr}></script>)
      end

      def relative_url_root
        Gitlab.config.gitlab.relative_url_root.to_s.chomp('/')
      end
    end
  end
end
