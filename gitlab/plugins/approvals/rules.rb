# frozen_string_literal: true

require 'yaml'

module Dsoaas
  module Approvals
    # Parses and validates `.gitlab/approvals.yml`. Pure Ruby (no GitLab
    # constants), so it can be loaded at boot and exercised without Rails.
    #
    #   rules:
    #     - name: default
    #       required: 2
    #       approvers: { users: [alice], groups: [platform/leads] }  # omit = anyone allowed to approve
    #     - name: security
    #       required: 1
    #       paths: ["infra/**", "**/Dockerfile"]                    # omit = always applies
    #       branches: [main, "release/*"]                           # omit = all target branches
    #       approvers: { groups: [security] }
    #     - name: sign-off
    #       require_all: true                                       # every listed user must approve
    #       approvers: { users: [alice] }
    #   author_can_approve: false       # default false
    #   committers_can_approve: true    # default true
    #   reset_on_push: true             # default true
    class Rules
      PATH = '.gitlab/approvals.yml'
      MAX_RULES = 50
      MAX_BYTES = 64 * 1024

      class InvalidConfig < StandardError; end

      Rule = Struct.new(:name, :required, :paths, :users, :groups, :branches, :require_all, keyword_init: true) do
        def any_approver?
          users.empty? && groups.empty?
        end

        def applies_to?(changed_paths)
          return true if paths.empty?

          changed_paths.any? { |path| paths.any? { |glob| Rules.glob_match?(glob, path) } }
        end
      end

      attr_reader :rules, :author_can_approve, :committers_can_approve, :reset_on_push

      def self.parse(yaml)
        raise InvalidConfig, "file larger than #{MAX_BYTES} bytes" if yaml.to_s.bytesize > MAX_BYTES

        data = YAML.safe_load(yaml.to_s, permitted_classes: [], aliases: false)
        data = {} if data.nil?
        raise InvalidConfig, 'top level must be a mapping' unless data.is_a?(Hash)

        new(data)
      rescue Psych::Exception => e
        raise InvalidConfig, "YAML error: #{e.message}"
      end

      # `dir/**` matches everything below dir; `**/x` matches x at any depth (incl. root).
      def self.glob_match?(glob, path)
        pattern = glob.sub(%r{/\*\*\z}, '/**/*')
        File.fnmatch?(pattern, path, File::FNM_PATHNAME | File::FNM_DOTMATCH | File::FNM_EXTGLOB)
      end

      def initialize(data)
        unknown = data.keys.map(&:to_s) - %w[rules author_can_approve committers_can_approve reset_on_push]
        raise InvalidConfig, "unknown key(s): #{unknown.join(', ')}" if unknown.any?

        @author_can_approve = boolean(data, 'author_can_approve', false)
        @committers_can_approve = boolean(data, 'committers_can_approve', true)
        @reset_on_push = boolean(data, 'reset_on_push', true)
        @rules = parse_rules(data['rules'])
      end

      def applicable(changed_paths)
        rules.select { |rule| rule.applies_to?(changed_paths) }
      end

      private

      def boolean(data, key, default)
        return default unless data.key?(key)
        return data[key] if [true, false].include?(data[key])

        raise InvalidConfig, "#{key} must be true or false"
      end

      def parse_rules(raw)
        raise InvalidConfig, 'rules must be a list' unless raw.is_a?(Array)
        raise InvalidConfig, 'rules must not be empty' if raw.empty?
        raise InvalidConfig, "at most #{MAX_RULES} rules" if raw.size > MAX_RULES

        names = []
        raw.each_with_index.map do |item, index|
          raise InvalidConfig, "rule ##{index + 1} must be a mapping" unless item.is_a?(Hash)

          unknown = item.keys.map(&:to_s) - %w[name required paths approvers branches require_all]
          raise InvalidConfig, "rule ##{index + 1}: unknown key(s): #{unknown.join(', ')}" if unknown.any?

          name = item['name'].to_s.strip
          raise InvalidConfig, "rule ##{index + 1}: name is required" if name.empty?
          raise InvalidConfig, "duplicate rule name: #{name}" if names.include?(name)

          names << name

          approvers = item['approvers'] || {}
          raise InvalidConfig, "rule #{name}: approvers must be a mapping" unless approvers.is_a?(Hash)

          unknown = approvers.keys.map(&:to_s) - %w[users groups]
          raise InvalidConfig, "rule #{name}: unknown approvers key(s): #{unknown.join(', ')}" if unknown.any?

          users = string_list(approvers, 'users', name).map { |u| u.delete_prefix('@') }.uniq
          groups = string_list(approvers, 'groups', name).map { |g| g.delete_prefix('@') }.uniq
          require_all = boolean(item, 'require_all', false)

          if require_all
            raise InvalidConfig, "rule #{name}: require_all needs approvers.users" if users.empty?
            raise InvalidConfig, "rule #{name}: require_all can't use groups" if groups.any?
            raise InvalidConfig, "rule #{name}: don't set required together with require_all" if item.key?('required')

            required = users.size
          else
            required = item['required']
            unless required.is_a?(Integer) && required.between?(1, 25)
              raise InvalidConfig, "rule #{name}: required must be an integer from 1 to 25"
            end
          end

          Rule.new(
            name: name,
            required: required,
            paths: string_list(item, 'paths', name),
            users: users,
            groups: groups,
            branches: string_list(item, 'branches', name),
            require_all: require_all
          )
        end
      end

      def string_list(hash, key, rule_name)
        value = hash[key]
        return [] if value.nil?
        unless value.is_a?(Array) && value.all? { |v| v.is_a?(String) && !v.strip.empty? }
          raise InvalidConfig, "rule #{rule_name}: #{key} must be a list of strings"
        end

        value.map(&:strip)
      end
    end
  end
end
