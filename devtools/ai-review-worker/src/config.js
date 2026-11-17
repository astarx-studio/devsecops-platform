import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import Ajv from "ajv";
import { matchesAny } from "./globs.js";

// review.yaml is re-read at the start of every job. An invalid edit is rejected
// and the last good config stays in use, so a typo never stops reviews.

export const BUILTIN_DEFAULTS = {
  scope: {
    target_branches: ["**"],
    source_branch_include: ["**"],
    source_branch_exclude: [],
    skip_draft: true,
    skip_labels: ["no-ai-review"],
    require_qestor_items: false,
  },
  model: {
    provider: "openai-compatible",
    base_url: "http://devtools-llm:8080/v1",
    model: "bonsai",
    api_key_env: "",
    context_tokens: 16384,
    max_output_tokens: 2048,
    temperature: 0.1,
    timeout_s: 240,
    structured_output: "json_schema",
    runner_config: "",
    extra_headers: {},
    // Merged into the provider request body as-is (e.g. llama.cpp chat_template_kwargs).
    extra_body: {},
  },
  context: {
    related_code: true,
    max_symbols: 10,
    max_hits_per_symbol: 6,
    list_sibling_files: true,
    // Shares of the input budget. The diff gets what is left.
    share: { items: 0.12, related: 0.15, repos: 0.2, reads: 0.15 },
  },
  guardrails: {
    // Secrets in added lines: block (blocker, never approve) | warn (potential bug) | off.
    secret_scan: "block",
    // Prompt-injection phrases in added lines, MR text or item text: block | warn | off.
    injection_scan: "block",
    // Redact secrets from everything sent to the model.
    redact_prompt: true,
    // Hosts that links in posted text may point to. Others become plain text.
    link_hosts: [
      "gitlab.devops.yadatechnology.com",
      "qestor.apps.yadatechnology.com",
      "qestor.app",
    ],
    max_note_chars: 200000,
    max_qestor_chars: 19000,
  },
  related: {
    // GitLab paths: projects, groups (all their projects), or globs; `!` excludes.
    // The X-Review-Related webhook header replaces this list when sent.
    paths: [],
    // Globs a related project must match, whatever config or header asks for.
    allowed: ["**"],
    // The X-Review-Related-Max header replaces max_projects for that webhook,
    // but never goes above max_projects_ceiling.
    max_projects: 5,
    max_projects_ceiling: 10,
    // Without any configured path, find the other half automatically:
    // same_branch_and_item = an open MR elsewhere with the same source branch
    // that also names one of this MR's Qestor items; same_branch = branch
    // alone; off. Bounded by `allowed` and the project cap.
    discover: "same_branch_and_item",
    // How to find the paired change in each related project, in order.
    pair_by: ["branch", "qestor_item"],
    // No paired MR: compare against target_branch (falls back to the
    // default branch), default_branch, or skip the project (none).
    fallback: "target_branch",
    max_terms: 12,
    max_hits_per_term: 5,
    max_paired_diff_bytes: 60000,
    // Re-review the paired MRs when this MR gets a new push.
    rereview_paired: true,
  },
  loop: {
    max_read_rounds: 3,
    max_reads_per_round: 8,
    max_read_lines: 200,
    max_grep_hits: 20,
    max_extra_qestor_ids: 5,
    max_diff_bytes: 400000,
    on_diff_over_cap: "truncate",
  },
  standard: {
    standard_file: "standard.md",
    extra_standard_files: [],
    // Extra focus for the review, added to the prompt. The X-Review-Extras
    // webhook header adds to this (it doesn't replace it).
    extra_instructions: "",
    severity_definitions: {
      blocker:
        "A definite break, data loss, security hole, build failure, or a business rule the linked item or the diff states and this change violates. Must be fixed before merge.",
      potential_bug:
        "A likely wrong outcome on a path this change reaches. Name the input, the wrong result, and why. A hedge without that outcome is not a potential bug. It still blocks approval.",
      recommendation:
        "A concrete change that prevents a real technical or business miss and is not already a bug. Not style, naming, or a comment.",
    },
    ignore_paths: [
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/*.min.js",
      "**/dist/**",
      "**/generated/**",
    ],
  },
  approve: {
    enabled: true,
    require_no_blockers: true,
    require_no_potential_bugs: true,
    require_match: true,
    // all_done: every linked item must be done (partial or missing = blocker).
    // none_missing: missing = blocker, partial = potential bug.
    // any_done: at least one item done; the rest become recommendations.
    item_match: "all_done",
    // The bot only approves what it fully saw: no approval when the diff or
    // the related repositories were cut to fit, or a related repo failed.
    never_when_truncated: true,
    never_when_related_failed: true,
    // Bigger changes need a human (0 = no limit). Counts added + removed lines.
    max_changed_lines: 1500,
    never_on_paths: [
      ".gitlab-ci.yml",
      ".dsoaas/**",
      "**/chart-values.yaml",
      "**/Dockerfile",
      "**/docker-compose*.yml",
      "**/migrations/**",
    ],
    unapprove_on_regression: true,
  },
  note: {
    sections: [
      "related_repos",
      "match",
      "regression",
      "blockers",
      "potential_bugs",
      "recommendations",
    ],
    language: "en",
    show_footer: true,
    queued_notice: true,
    // Wrap code-looking tokens the model left as plain text in backticks.
    format_code: true,
  },
  inline: {
    enabled: true,
    max_comments: 20,
    kinds: ["blockers", "potential_bugs", "recommendations"],
    // How far (lines) a finding may sit from a changed line and still anchor.
    anchor_slack: 3,
    // reply | leave | delete: what to do with the bot's earlier inline
    // comments whose problem is no longer reported.
    stale: "reply",
  },
  qestor_notice: {
    enabled: true,
    // Comment on every linked Qestor item when a review rejects the MR.
    on_rejected: true,
    max_findings: 5,
  },
  runtime: {
    run_timeout_s: 600,
    retry_count: 1,
    // Reviews of one MR head (first run + refreshes when the paired side
    // changes). Stops two paired MRs from re-reviewing each other forever.
    max_runs_per_head: 4,
    // Circuit breaker: reviews of one MR in the last hour, across all heads
    // (pushes, refreshes, re-reviews). Beyond it, events are dropped until
    // the hour rolls over, so no feedback path can run away.
    max_runs_per_mr_per_hour: 12,
    // Infrastructure failures (DB, queue) on one queue message before it goes
    // to the dead-letter queue instead of being retried again.
    max_deliveries: 10,
    supersede_stale: true,
  },
};

const SECTION_NAMES = [
  "related_repos",
  "match",
  "regression",
  "blockers",
  "potential_bugs",
  "recommendations",
];
const share = { type: "number", minimum: 0, maximum: 0.6 };

const strList = { type: "array", items: { type: "string" } };
const blockSchema = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
});

const blocks = {
  scope: blockSchema({
    target_branches: strList,
    source_branch_include: strList,
    source_branch_exclude: strList,
    skip_draft: { type: "boolean" },
    skip_labels: strList,
    require_qestor_items: { type: "boolean" },
  }),
  model: blockSchema({
    provider: { enum: ["openai-compatible", "anthropic", "ollama-native"] },
    base_url: { type: "string" },
    model: { type: "string", minLength: 1 },
    api_key_env: { type: "string" },
    context_tokens: { type: "integer", minimum: 2048 },
    max_output_tokens: { type: "integer", minimum: 256 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    timeout_s: { type: "integer", minimum: 10 },
    structured_output: { enum: ["json_schema", "json_object", "prompt"] },
    runner_config: { type: "string" },
    extra_headers: { type: "object", additionalProperties: { type: "string" } },
    extra_body: { type: "object" },
  }),
  context: blockSchema({
    related_code: { type: "boolean" },
    max_symbols: { type: "integer", minimum: 0, maximum: 50 },
    max_hits_per_symbol: { type: "integer", minimum: 1, maximum: 50 },
    list_sibling_files: { type: "boolean" },
    share: {
      type: "object",
      additionalProperties: false,
      properties: { items: share, related: share, repos: share, reads: share },
    },
  }),
  guardrails: blockSchema({
    secret_scan: { enum: ["block", "warn", "off"] },
    injection_scan: { enum: ["block", "warn", "off"] },
    redact_prompt: { type: "boolean" },
    link_hosts: strList,
    max_note_chars: { type: "integer", minimum: 10000, maximum: 1000000 },
    max_qestor_chars: { type: "integer", minimum: 1000, maximum: 20000 },
  }),
  related: blockSchema({
    paths: strList,
    allowed: strList,
    max_projects: { type: "integer", minimum: 0, maximum: 20 },
    max_projects_ceiling: { type: "integer", minimum: 0, maximum: 20 },
    discover: { enum: ["same_branch_and_item", "same_branch", "off"] },
    pair_by: { type: "array", items: { enum: ["branch", "qestor_item"] } },
    fallback: { enum: ["target_branch", "default_branch", "none"] },
    max_terms: { type: "integer", minimum: 0, maximum: 50 },
    max_hits_per_term: { type: "integer", minimum: 1, maximum: 50 },
    max_paired_diff_bytes: { type: "integer", minimum: 1000 },
    rereview_paired: { type: "boolean" },
  }),
  inline: blockSchema({
    enabled: { type: "boolean" },
    max_comments: { type: "integer", minimum: 0, maximum: 100 },
    kinds: {
      type: "array",
      items: { enum: ["blockers", "potential_bugs", "recommendations"] },
    },
    anchor_slack: { type: "integer", minimum: 0, maximum: 20 },
    stale: { enum: ["reply", "leave", "delete"] },
  }),
  qestor_notice: blockSchema({
    enabled: { type: "boolean" },
    on_rejected: { type: "boolean" },
    max_findings: { type: "integer", minimum: 0, maximum: 50 },
  }),
  loop: blockSchema({
    max_read_rounds: { type: "integer", minimum: 0, maximum: 10 },
    max_reads_per_round: { type: "integer", minimum: 1, maximum: 20 },
    max_read_lines: { type: "integer", minimum: 10, maximum: 2000 },
    max_grep_hits: { type: "integer", minimum: 1, maximum: 200 },
    max_extra_qestor_ids: { type: "integer", minimum: 0, maximum: 20 },
    max_diff_bytes: { type: "integer", minimum: 1000 },
    on_diff_over_cap: { enum: ["truncate", "skip"] },
  }),
  standard: blockSchema({
    standard_file: { type: "string" },
    extra_standard_files: strList,
    extra_instructions: { type: "string", maxLength: 4000 },
    severity_definitions: {
      type: "object",
      additionalProperties: false,
      properties: {
        blocker: { type: "string" },
        potential_bug: { type: "string" },
        recommendation: { type: "string" },
      },
    },
    ignore_paths: strList,
  }),
  approve: blockSchema({
    enabled: { type: "boolean" },
    require_no_blockers: { type: "boolean" },
    require_no_potential_bugs: { type: "boolean" },
    require_match: { type: "boolean" },
    item_match: { enum: ["all_done", "none_missing", "any_done"] },
    never_when_truncated: { type: "boolean" },
    never_when_related_failed: { type: "boolean" },
    max_changed_lines: { type: "integer", minimum: 0 },
    never_on_paths: strList,
    unapprove_on_regression: { type: "boolean" },
  }),
  note: blockSchema({
    sections: { type: "array", items: { enum: SECTION_NAMES } },
    language: { type: "string" },
    show_footer: { type: "boolean" },
    queued_notice: { type: "boolean" },
    format_code: { type: "boolean" },
  }),
  runtime: blockSchema({
    run_timeout_s: { type: "integer", minimum: 30 },
    retry_count: { type: "integer", minimum: 0, maximum: 5 },
    max_runs_per_head: { type: "integer", minimum: 1, maximum: 20 },
    max_runs_per_mr_per_hour: { type: "integer", minimum: 1, maximum: 200 },
    max_deliveries: { type: "integer", minimum: 1, maximum: 100 },
    supersede_stale: { type: "boolean" },
  }),
};

const layer = blockSchema(blocks);
const fileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled_projects: strList,
    defaults: layer,
    projects: { type: "object", additionalProperties: layer },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateFile = ajv.compile(fileSchema);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Objects merge key by key; arrays and scalars replace.
export function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [k, v] of Object.entries(over))
    out[k] = isPlainObject(v) ? deepMerge(out[k], v) : v;
  return out;
}

export function parseConfigText(text) {
  const raw = YAML.parse(text) ?? {};
  if (!validateFile(raw)) {
    const msg = validateFile.errors
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`review.yaml invalid: ${msg}`);
  }
  const file = {
    enabled_projects: raw.enabled_projects ?? ["**"],
    defaults: deepMerge(BUILTIN_DEFAULTS, raw.defaults ?? {}),
    projects: raw.projects ?? {},
  };
  for (const [name, over] of Object.entries(file.projects)) {
    const merged = deepMerge(file.defaults, over);
    checkModelBudget(merged, `projects.${name}`);
  }
  checkModelBudget(file.defaults, "defaults");
  return file;
}

function checkModelBudget(cfg, where) {
  if (cfg.model.max_output_tokens >= cfg.model.context_tokens / 2) {
    throw new Error(
      `${where}.model.max_output_tokens must be under half of context_tokens`,
    );
  }
}

// Reads `--ctx-size N` (or `-c N`) from the llama-swap file, so a context
// budget larger than the runner allows is refused with a clear message.
export function runnerCtxSize(runnerConfigPath) {
  if (!runnerConfigPath || !fs.existsSync(runnerConfigPath)) return null;
  const text = fs.readFileSync(runnerConfigPath, "utf8");
  const m = text.match(/(?:--ctx-size|\s-c)\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

export function resolveProject(file, projectPath) {
  const cfg = deepMerge(file.defaults, file.projects[projectPath] ?? {});
  const ctx = runnerCtxSize(cfg.model.runner_config);
  if (ctx != null && cfg.model.context_tokens > ctx) {
    throw new Error(
      `model.context_tokens ${cfg.model.context_tokens} is larger than the runner --ctx-size ${ctx} in ${cfg.model.runner_config}`,
    );
  }
  return cfg;
}

export function projectEnabled(file, projectPath) {
  return matchesAny(projectPath, file.enabled_projects);
}

export class ConfigStore {
  constructor(configPath, log = console) {
    this.path = configPath;
    this.dir = path.dirname(configPath);
    this.log = log;
    this.good = null;
    this.goodText = null;
  }

  // Called per job. Returns the last good config when the file is broken.
  load() {
    let text;
    try {
      text = fs.readFileSync(this.path, "utf8");
    } catch (err) {
      if (this.good) {
        this.log.error(
          `config: cannot read ${this.path} (${err.message}); keeping last good config`,
        );
        return this.good;
      }
      throw err;
    }
    if (text === this.goodText) return this.good;
    try {
      this.good = parseConfigText(text);
      this.goodText = text;
      this.log.info(`config: loaded ${this.path}`);
    } catch (err) {
      if (!this.good) throw err;
      this.log.error(`config: ${err.message}; keeping last good config`);
    }
    return this.good;
  }

  // Standard files are relative to the config directory and may not leave it.
  readConfigFile(rel) {
    if (!rel) return "";
    const full = path.resolve(this.dir, rel);
    if (!full.startsWith(path.resolve(this.dir) + path.sep))
      throw new Error(`config file outside config dir: ${rel}`);
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  }
}
