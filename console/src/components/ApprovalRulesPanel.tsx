"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { graphqlRequest } from "@/lib/client";
import type { Project } from "@/lib/types";

/**
 * Merge request approval rules for one project, enforced by the platform's
 * GitLab approvals plugin. Rules saved here take priority over the repository's
 * `.gitlab/approvals.yml`, which stays as the fallback when no rules are set.
 */

type Source = "console" | "file" | "none";

interface Rule {
  name: string;
  required: number;
  paths: string[];
  users: string[];
  groups: string[];
}

interface RuleSet {
  source: Source;
  rules: Rule[];
  authorCanApprove: boolean;
  committersCanApprove: boolean;
  resetOnPush: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  repositoryFile: string | null;
}

interface Draft {
  rules: Rule[];
  authorCanApprove: boolean;
  committersCanApprove: boolean;
  resetOnPush: boolean;
}

const FIELDS = `
  source
  rules { name required paths users groups }
  authorCanApprove
  committersCanApprove
  resetOnPush
  updatedBy
  updatedAt
  repositoryFile
`;

const QUERY = `query ProjectApprovalRules($projectId: ID!) {
  projectApprovalRules(projectId: $projectId) { ${FIELDS} }
}`;

const SAVE = `mutation SetProjectApprovalRules($projectId: ID!, $input: ApprovalRulesInput!) {
  setProjectApprovalRules(projectId: $projectId, input: $input) { ${FIELDS} }
}`;

const CLEAR = `mutation ClearProjectApprovalRules($projectId: ID!) {
  clearProjectApprovalRules(projectId: $projectId) { ${FIELDS} }
}`;

const MAX_REQUIRED = 25;

const emptyRule = (name: string): Rule => ({
  name,
  required: 1,
  paths: [],
  users: [],
  groups: [],
});

function toDraft(set: RuleSet): Draft {
  return {
    rules: set.rules.map((rule) => ({ ...rule })),
    authorCanApprove: set.authorCanApprove,
    committersCanApprove: set.committersCanApprove,
    resetOnPush: set.resetOnPush,
  };
}

function validate(draft: Draft): string | null {
  if (!draft.rules.length) return "Add at least one rule.";
  const names = new Set<string>();
  for (const [index, rule] of draft.rules.entries()) {
    const name = rule.name.trim();
    if (!name) return `Rule ${index + 1} needs a name.`;
    if (names.has(name)) return `Two rules are named "${name}".`;
    names.add(name);
    if (
      !Number.isInteger(rule.required) ||
      rule.required < 1 ||
      rule.required > MAX_REQUIRED
    ) {
      return `"${name}" needs between 1 and ${MAX_REQUIRED} approvals.`;
    }
  }
  return null;
}

interface ChipFieldProps {
  label: string;
  helperText: string;
  placeholder: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}

/** Free-text list: type a value and press Enter (or paste comma-separated values). */
function ChipField({
  label,
  helperText,
  placeholder,
  value,
  disabled,
  onChange,
}: ChipFieldProps) {
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      options={[] as string[]}
      value={value}
      disabled={disabled}
      onChange={(_event, next) => {
        const cleaned = next
          .flatMap((item) => String(item).split(","))
          .map((item) => item.trim().replace(/^@/, ""))
          .filter(Boolean);
        onChange([...new Set(cleaned)]);
      }}
      renderTags={(items, getTagProps) =>
        items.map((item, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} size="small" label={item} {...tagProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={label}
          helperText={helperText}
          placeholder={value.length ? "" : placeholder}
        />
      )}
    />
  );
}

interface Props {
  project: Project;
}

export function ApprovalRulesPanel({ project }: Props) {
  const [saved, setSaved] = useState<RuleSet | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [showFile, setShowFile] = useState(false);

  const apply = useCallback((set: RuleSet) => {
    setSaved(set);
    setDraft(toDraft(set));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSaved(null);
    setDraft(null);
    graphqlRequest<{ projectApprovalRules: RuleSet }>(QUERY, {
      projectId: project.id,
    })
      .then((data) => {
        if (!cancelled) apply(data.projectApprovalRules);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, apply]);

  const dirty = useMemo(
    () =>
      !!saved &&
      !!draft &&
      JSON.stringify(draft) !== JSON.stringify(toDraft(saved)),
    [saved, draft],
  );

  const updateRule = useCallback((index: number, patch: Partial<Rule>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            rules: current.rules.map((rule, i) =>
              i === index ? { ...rule, ...patch } : rule,
            ),
          }
        : current,
    );
  }, []);

  const addRule = useCallback(() => {
    setDraft((current) => {
      if (!current) return current;
      const name = current.rules.some((rule) => rule.name === "default")
        ? ""
        : "default";
      return { ...current, rules: [...current.rules, emptyRule(name)] };
    });
  }, []);

  const removeRule = useCallback((index: number) => {
    setDraft((current) =>
      current
        ? { ...current, rules: current.rules.filter((_rule, i) => i !== index) }
        : current,
    );
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await graphqlRequest<{ setProjectApprovalRules: RuleSet }>(
        SAVE,
        {
          projectId: project.id,
          input: {
            rules: draft.rules.map((rule) => ({
              name: rule.name.trim(),
              required: rule.required,
              paths: rule.paths,
              users: rule.users,
              groups: rule.groups,
            })),
            authorCanApprove: draft.authorCanApprove,
            committersCanApprove: draft.committersCanApprove,
            resetOnPush: draft.resetOnPush,
          },
        },
      );
      apply(data.setProjectApprovalRules);
      setNotice("Saved. GitLab applies the new rules within about 15 seconds.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draft, project.id, apply]);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await graphqlRequest<{ clearProjectApprovalRules: RuleSet }>(
        CLEAR,
        { projectId: project.id },
      );
      apply(data.clearProjectApprovalRules);
      setNotice("Console rules removed.");
      setClearOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [project.id, apply]);

  if (loading) {
    return (
      <Stack
        role="status"
        aria-live="polite"
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ py: 3, px: 1 }}
      >
        <CircularProgress size={22} aria-hidden />
        <Typography color="text.secondary">Loading approval rules</Typography>
      </Stack>
    );
  }

  if (!saved || !draft) {
    return (
      <Alert severity="error">
        {error ?? "Approval rules could not be loaded."}
      </Alert>
    );
  }

  const hasFile = saved.repositoryFile !== null;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
          Merge request approvals
        </Typography>
        <Typography variant="body2" color="text.secondary">
          GitLab blocks merging until every rule that applies to a merge request
          has enough approvals. Rules set here can only be changed in this
          console, not from the repository.
        </Typography>
      </Box>

      {saved.source === "console" && (
        <Alert severity="success">
          GitLab enforces the rules below.
          {saved.updatedAt && (
            <>
              {" "}
              Last changed {new Date(saved.updatedAt).toLocaleString()}
              {saved.updatedBy ? ` by ${saved.updatedBy}` : ""}.
            </>
          )}
          {hasFile && (
            <>
              {" "}
              The repository&apos;s <code>.gitlab/approvals.yml</code> is ignored
              while these are set.
            </>
          )}
        </Alert>
      )}
      {saved.source === "file" && (
        <Alert severity="info">
          No rules are set here, so GitLab uses the repository&apos;s{" "}
          <code>.gitlab/approvals.yml</code> as a fallback. Anyone who can merge
          to the default branch can change that file. Save rules here to take
          over.
        </Alert>
      )}
      {saved.source === "none" && (
        <Alert severity="warning">
          This project has no approval rules. Merge requests can be merged
          without approval.
        </Alert>
      )}

      {hasFile && (
        <Box>
          <Button size="small" onClick={() => setShowFile((open) => !open)}>
            {showFile ? "Hide" : "Show"} repository file
          </Button>
          {showFile && (
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1.5,
                borderRadius: 1,
                bgcolor: "action.hover",
                fontSize: 12.5,
                overflow: "auto",
                maxHeight: 260,
              }}
            >
              {saved.repositoryFile}
            </Box>
          )}
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}

      {draft.rules.map((rule, index) => (
        <Paper key={index} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <TextField
                size="small"
                label="Rule name"
                value={rule.name}
                disabled={busy}
                onChange={(event) =>
                  updateRule(index, { name: event.target.value })
                }
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                type="number"
                label="Approvals required"
                value={Number.isNaN(rule.required) ? "" : rule.required}
                disabled={busy}
                onChange={(event) =>
                  updateRule(index, {
                    required: Number.parseInt(event.target.value, 10),
                  })
                }
                slotProps={{ htmlInput: { min: 1, max: MAX_REQUIRED } }}
                sx={{ width: 170 }}
              />
              <Tooltip title="Remove rule">
                <span>
                  <IconButton
                    aria-label={`Remove rule ${rule.name || index + 1}`}
                    disabled={busy}
                    onClick={() => removeRule(index)}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            <ChipField
              label="Approver users"
              placeholder="GitLab username, then Enter"
              helperText="Leave users and groups empty to let anyone with Developer access or higher approve."
              value={rule.users}
              disabled={busy}
              onChange={(users) => updateRule(index, { users })}
            />
            <ChipField
              label="Approver groups"
              placeholder="Full group path, e.g. clients/acme/leads"
              helperText="Members of these GitLab groups count, including inherited members."
              value={rule.groups}
              disabled={busy}
              onChange={(groups) => updateRule(index, { groups })}
            />
            <ChipField
              label="Only when these paths change"
              placeholder="e.g. infra/** or **/Dockerfile"
              helperText="Leave empty to apply the rule to every merge request."
              value={rule.paths}
              disabled={busy}
              onChange={(paths) => updateRule(index, { paths })}
            />
          </Stack>
        </Paper>
      ))}

      <Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={busy}
          onClick={addRule}
        >
          Add rule
        </Button>
      </Box>

      <Stack>
        <FormControlLabel
          control={
            <Switch
              checked={draft.resetOnPush}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, resetOnPush: event.target.checked })
              }
            />
          }
          label="Drop approvals when the code changes"
        />
        <FormControlLabel
          control={
            <Switch
              checked={draft.authorCanApprove}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, authorCanApprove: event.target.checked })
              }
            />
          }
          label="The author's own approval counts"
        />
        <FormControlLabel
          control={
            <Switch
              checked={draft.committersCanApprove}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  committersCanApprove: event.target.checked,
                })
              }
            />
          }
          label="Approvals from people who pushed commits count"
        />
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button
          variant="contained"
          disabled={busy || !dirty || !draft.rules.length}
          onClick={() => void save()}
        >
          Save rules
        </Button>
        {dirty && (
          <Button disabled={busy} onClick={() => setDraft(toDraft(saved))}>
            Discard changes
          </Button>
        )}
        {saved.source === "console" && (
          <Button
            color="error"
            disabled={busy}
            onClick={() => setClearOpen(true)}
          >
            Remove console rules
          </Button>
        )}
      </Stack>

      <ConfirmDialog
        open={clearOpen}
        title="Remove console rules?"
        message={
          hasFile
            ? "GitLab will go back to the repository's .gitlab/approvals.yml for this project."
            : "This project has no .gitlab/approvals.yml, so merge requests will no longer need approval."
        }
        confirmLabel="Remove rules"
        busy={busy}
        onClose={() => setClearOpen(false)}
        onConfirm={() => void clear()}
      />
    </Stack>
  );
}
