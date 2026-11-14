# frozen_string_literal: true

# Build-time version gate (run by gitlab/Dockerfile with GitLab's own Ruby).
#
# Every plugin declares the GitLab versions it was reviewed against in
# <plugin>/supported.txt. Building on a GitLab outside that range fails here,
# instead of producing an image whose plugin silently skips itself at boot
# (GitLab would run without approval enforcement).
#
#   ruby check-versions.rb <rails_root> <plugins_dir>

require 'rubygems'

rails_root, plugins_dir = ARGV
abort 'usage: check-versions.rb <rails_root> <plugins_dir>' unless rails_root && plugins_dir

raw = File.read(File.join(rails_root, 'VERSION')).strip
version = Gem::Version.new(raw.sub(/-.*/, ''))
failures = []

Dir[File.join(plugins_dir, '*', 'supported.txt')].sort.each do |file|
  plugin = File.basename(File.dirname(file))
  lines = File.readlines(file, chomp: true).map(&:strip).reject { |l| l.empty? || l.start_with?('#') }
  requirement = Gem::Requirement.new(*lines)
  if requirement.satisfied_by?(version)
    puts "[dsoaas] version gate: #{plugin} supports GitLab #{raw} (#{requirement})"
  else
    failures << "#{plugin} was reviewed for GitLab #{requirement}, this image is #{raw}"
  end
end

if Dir[File.join(plugins_dir, '*', 'plugin.rb')].size != Dir[File.join(plugins_dir, '*', 'supported.txt')].size
  failures << 'every plugin needs a supported.txt next to its plugin.rb'
end

unless failures.empty?
  warn '[dsoaas] VERSION GATE FAILED:'
  failures.each { |f| warn "  - #{f}" }
  warn '  Re-check the seams (gitlab/seams.txt, contract + canary) for this GitLab,'
  warn '  then widen the range in gitlab/plugins/<plugin>/supported.txt.'
  exit 1
end
