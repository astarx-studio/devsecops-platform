# frozen_string_literal: true

module Dsoaas
  module Approvals
    # Target branches of a native rule. A rule targets:
    #   - all protected branches (applies_to_all_protected_branches), or
    #   - branch rules, linked by protected branch ID (protected_branches: {id => name}),
    #     plus free patterns (branches), or
    #   - nothing listed: every branch.
    #
    # Linked targets use the branch rule's CURRENT name, so renaming a branch rule
    # carries its approval rules along. A link whose branch rule was deleted falls
    # back to the name saved with the rule (still enforced, never widened).
    module RuleTargets
      Resolved = Struct.new(:linked, :patterns, :stale, keyword_init: true) do
        # Every pattern the MR target branch is matched against.
        def names
          linked.map(&:name) | patterns
        end
      end

      module_function

      def links(row)
        raw = row['protected_branches']
        raw = JSON.parse(raw) if raw.is_a?(String)
        (raw || {}).to_h { |id, name| [id.to_i, name.to_s] }
      end

      def resolve(project, row)
        links = links(row)
        found = links.empty? ? [] : project.protected_branches.where(id: links.keys).order(:name, :id).to_a
        linked = found.uniq(&:name)
        stale = links.except(*found.map(&:id)).values - linked.map(&:name)
        Resolved.new(linked: linked, patterns: Array(row['branches']) | stale, stale: stale)
      end

      # Splits requested targets into links and patterns: protected branch IDs and
      # names of this project's branch rules become links, anything else a pattern.
      # Returns [links {"id" => name}, patterns, missing_ids].
      def split(project, names, ids)
        found = ids.empty? ? [] : project.protected_branches.where(id: ids).to_a
        # One link per name (a project can briefly hold two protected branches with the same name).
        by_name = names.empty? ? [] : project.protected_branches.where(name: names).order(:id).to_a.uniq(&:name)
        linked = (found + by_name).uniq(&:id).uniq(&:name)
        [linked.to_h { |pb| [pb.id.to_s, pb.name] }, names - linked.map(&:name), ids - found.map(&:id)]
      end
    end
  end
end
