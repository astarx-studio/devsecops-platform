# frozen_string_literal: true

require 'erb'

module Dsoaas
  module Approvals
    # Adds the plugin's scripts to GitLab pages that are compiled Vue apps with no
    # view hook for them:
    #   - merge request pages (/<project>/-/merge_requests/<iid>[/tab]): the
    #     approvals widget;
    #   - Settings > Repository (branch rules list) and its branch rule pages
    #     (/<project>/-/settings/repository/branch_rules?branch=...): approval
    #     rules per branch rule.
    # The tags are appended before </body> of HTML GET responses; everything else
    # passes through untouched. Inserted after Rails' CSP middleware, so it sees
    # the request's CSP nonce (if GitLab generated one) and reuses it.
    class Middleware
      MR_PATH = %r{\A/(?<project>.+?)/-/merge_requests/(?<iid>\d+)(?:/(?:diffs|commits|pipelines|reports))?/?\z}
      BRANCH_RULE_PATH = %r{\A/(?<project>.+?)/-/settings/repository/branch_rules/?\z}
      REPOSITORY_SETTINGS_PATH = %r{\A/(?<project>.+?)/-/settings/repository/?\z}
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
        if (m = path.match(MR_PATH))
          [:mr, m]
        elsif (m = path.match(BRANCH_RULE_PATH))
          [:branch_rule, m]
        elsif (m = path.match(REPOSITORY_SETTINGS_PATH))
          [:repository, m]
        end
      end

      def tags(env, (page, match))
        nonce = env[NONCE_KEY]
        attrs = { 'nonce' => nonce, 'data-project' => match[:project], 'data-api-root' => "#{relative_url_root}/api/v4" }
        link = %(<link rel="stylesheet" href="#{esc(Assets.path('approvals.css'))}">)
        case page
        when :mr
          link + script('mr_widget.js', attrs.merge('data-dsoaas-approvals' => '', 'data-iid' => match[:iid].to_i))
        else
          attrs = attrs.merge('data-dsoaas-branch-rules' => '',
            'data-mode' => page == :branch_rule ? 'details' : 'list',
            'data-mr-settings-path' =>
              "#{relative_url_root}/#{match[:project]}/-/settings/merge_requests#js-merge-request-approval-settings")
          link + script('editor.js', 'nonce' => nonce) + script('branch_rules.js', attrs)
        end
      end

      def script(asset, attrs)
        rendered = attrs.filter_map do |key, value|
          next if value.nil?

          value == '' ? " #{key}" : %( #{key}="#{esc(value)}")
        end
        %(<script src="#{esc(Assets.path(asset))}" defer#{rendered.join}></script>)
      end

      def esc(value)
        ERB::Util.html_escape(value.to_s)
      end

      def relative_url_root
        Gitlab.config.gitlab.relative_url_root.to_s.chomp('/')
      end
    end
  end
end
