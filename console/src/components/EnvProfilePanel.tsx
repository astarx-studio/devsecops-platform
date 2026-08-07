"use client";

import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";

import { EnvKeyValueEditor } from "@/components/EnvKeyValueEditor";
import { EnvProfileDetailDialog } from "@/components/EnvProfileDetailDialog";
import { graphqlRequest } from "@/lib/client";
import {
  emptyEnvRows,
  parseDotenvToRows,
  serializeEnvRows,
  type EnvKeyValueRow,
} from "@/lib/env-dotenv";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { EnvProfile, Project } from "@/lib/types";

type InjectionPhase = "BUILD" | "RUNTIME";
type BuildDelivery = "RAW_FILE" | "DOTENV_BUILD_ARGS";
type ContentInputMode = "file" | "paste" | "per_key";

/** Display path for table (empty stored path = repo root). */
function formatWorkspacePath(workspacePath?: string | null): string {
  if (!workspacePath) {
    return "(repo root)";
  }
  return workspacePath;
}

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

const emptyForm = {
  label: "",
  injectionPhase: "RUNTIME" as InjectionPhase,
  branches: "main",
  content: "",
  deploymentTargetKeys: [] as string[],
  jobSelector: "",
  workspacePath: "",
  filename: ".env",
  buildDelivery: "DOTENV_BUILD_ARGS" as BuildDelivery,
  contentType: "",
};

export function EnvProfilePanel({ project, onUpdated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [contentMode, setContentMode] = useState<ContentInputMode>("paste");
  const [keyRows, setKeyRows] = useState<EnvKeyValueRow[]>(emptyEnvRows());
  const [manageProfile, setManageProfile] = useState<EnvProfile | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const targetOptions = useMemo(
    () => project.deploymentTargets.map((t) => t.key),
    [project.deploymentTargets],
  );

  const isBuild = form.injectionPhase === "BUILD";
  const perKeyAllowed =
    form.injectionPhase === "RUNTIME" ||
    (form.injectionPhase === "BUILD" &&
      form.buildDelivery === "DOTENV_BUILD_ARGS");

  const resetCreateForm = useCallback(() => {
    setForm(emptyForm);
    setKeyRows(emptyEnvRows());
    setContentMode("paste");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const runMutation = useCallback(
    async (fn: () => Promise<Project>) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await fn();
        onUpdated(updated);
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onUpdated],
  );

  const resolveContent = useCallback((): string => {
    if (contentMode === "per_key" && perKeyAllowed) {
      return serializeEnvRows(keyRows);
    }
    return form.content;
  }, [contentMode, form.content, keyRows, perKeyAllowed]);

  const upload = () => {
    const branches = form.branches
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    const content = resolveContent();
    if (!branches.length || !form.label.trim() || !content.trim()) {
      setError("Label, branches, and file content are required.");
      return;
    }

    void (async () => {
      const ok = await runMutation(async () => {
        const input: Record<string, unknown> = {
          label: form.label.trim(),
          injectionPhase: form.injectionPhase,
          branches,
          content,
          jobSelector: form.jobSelector.trim() || undefined,
          contentType: form.contentType.trim() || undefined,
        };

        if (form.injectionPhase === "RUNTIME") {
          if (!form.deploymentTargetKeys.length) {
            throw new Error(
              "Select at least one deployment target for RUNTIME profiles.",
            );
          }
          input.deploymentTargetKeys = form.deploymentTargetKeys;
        } else {
          input.workspacePath = form.workspacePath.trim();
          input.filename = form.filename.trim();
          input.buildDelivery = form.buildDelivery;
        }

        await graphqlRequest<{ uploadEnvProfile: EnvProfile }>(
          MUTATIONS.uploadEnvProfile,
          { projectId: project.id, input },
        );

        const refreshed = await graphqlRequest<{ project: Project }>(
          QUERIES.project,
          { id: project.id },
        );
        return refreshed.project;
      });
      if (ok) {
        resetCreateForm();
      }
    })();
  };

  const remove = (profileId: string, label: string) => {
    if (
      !window.confirm(
        `Delete env profile "${label}"? Secrets will be removed from Vault.`,
      )
    ) {
      return;
    }
    void runMutation(async () => {
      const data = await graphqlRequest<{ deleteEnvProfile: Project }>(
        MUTATIONS.deleteEnvProfile,
        { projectId: project.id, profileId },
      );
      return data.deleteEnvProfile;
    });
  };

  const onFilePick = async (file: File | null) => {
    if (!file) {
      return;
    }
    const text = await file.text();
    setForm((f) => ({
      ...f,
      content: text,
      filename: f.filename || file.name,
    }));
    if (perKeyAllowed && contentMode === "per_key") {
      setKeyRows(parseDotenvToRows(text));
    }
  };

  const setContentInputMode = (
    _event: MouseEvent<HTMLElement>,
    next: ContentInputMode | null,
  ) => {
    if (!next) {
      return;
    }
    if (next === "per_key" && !perKeyAllowed) {
      return;
    }
    if (contentMode === "per_key" && next !== "per_key") {
      setForm((f) => ({ ...f, content: serializeEnvRows(keyRows) }));
    }
    if (next === "per_key" && contentMode !== "per_key") {
      setKeyRows(parseDotenvToRows(form.content));
    }
    setContentMode(next);
  };

  const onPhaseChange = (phase: InjectionPhase) => {
    const leavingPerKey =
      contentMode === "per_key" &&
      phase === "BUILD" &&
      form.buildDelivery === "RAW_FILE";

    if (leavingPerKey) {
      setForm((f) => ({
        ...f,
        injectionPhase: phase,
        content: serializeEnvRows(keyRows),
      }));
      setContentMode("paste");
      return;
    }
    setForm((f) => ({ ...f, injectionPhase: phase }));
  };

  const onDeliveryChange = (delivery: BuildDelivery) => {
    if (delivery === "RAW_FILE" && contentMode === "per_key") {
      setForm((f) => ({
        ...f,
        buildDelivery: delivery,
        content: serializeEnvRows(keyRows),
      }));
      setContentMode("paste");
      return;
    }
    setForm((f) => ({ ...f, buildDelivery: delivery }));
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>
          Env profiles (Vault)
        </Typography>
        <Chip
          size="small"
          label={
            project.runtimeEnvEnabled
              ? "runtime env: on"
              : "runtime env: off (static)"
          }
          color={project.runtimeEnvEnabled ? "primary" : "default"}
          variant="outlined"
        />
      </Stack>

      <Typography variant="body2" color="text.secondary">
        Upload branch-scoped config to Vault only. BUILD profiles bake at image
        build; RUNTIME profiles inject into pods per deployment target
        (including custom targets). Use Manage to view and edit existing
        values.
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Label</TableCell>
            <TableCell>Phase</TableCell>
            <TableCell>Branches</TableCell>
            <TableCell>Targets / file</TableCell>
            <TableCell>Keys</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(project.envProfiles ?? []).map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.label}</TableCell>
              <TableCell>{p.injectionPhase}</TableCell>
              <TableCell>{p.branches.join(", ")}</TableCell>
              <TableCell>
                {p.injectionPhase === "RUNTIME"
                  ? (p.deploymentTargetKeys ?? []).join(", ")
                  : `${formatWorkspacePath(p.workspacePath)}/${p.filename ?? ""} (${p.buildDelivery ?? "raw"})`}
              </TableCell>
              <TableCell>
                <Typography variant="caption" color="text.secondary">
                  {(p.keyNames ?? []).length
                    ? `${p.keyNames.length}: ${(p.keyNames ?? []).slice(0, 3).join(", ")}${(p.keyNames ?? []).length > 3 ? "…" : ""}`
                    : "—"}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                <Button
                  size="small"
                  startIcon={<EditIcon />}
                  disabled={busy}
                  onClick={() => setManageProfile(p)}
                >
                  Manage
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  disabled={busy}
                  onClick={() => remove(p.id, p.label)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!project.envProfiles?.length && (
            <TableRow>
              <TableCell colSpan={6}>
                <Typography variant="body2" color="text.secondary">
                  No env profiles yet.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Box
        component="fieldset"
        sx={{ border: "1px solid", borderColor: "divider", p: 2, m: 0 }}
      >
        <Typography component="legend" variant="subtitle2" sx={{ px: 1 }}>
          Upload profile
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Label"
              size="small"
              fullWidth
              value={form.label}
              onChange={(e) =>
                setForm((f) => ({ ...f, label: e.target.value }))
              }
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Phase</InputLabel>
              <Select
                label="Phase"
                value={form.injectionPhase}
                onChange={(e) =>
                  onPhaseChange(e.target.value as InjectionPhase)
                }
              >
                <MenuItem value="BUILD">BUILD (CI / image)</MenuItem>
                <MenuItem value="RUNTIME">RUNTIME (pod env)</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label="Branches (comma-separated, exact CI_COMMIT_REF_NAME)"
            size="small"
            fullWidth
            value={form.branches}
            onChange={(e) =>
              setForm((f) => ({ ...f, branches: e.target.value }))
            }
          />

          <TextField
            label="Job selector (optional, matches KANIKO_IMAGE_NAME)"
            size="small"
            fullWidth
            value={form.jobSelector}
            onChange={(e) =>
              setForm((f) => ({ ...f, jobSelector: e.target.value }))
            }
          />

          {isBuild ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Workspace path"
                size="small"
                fullWidth
                value={form.workspacePath}
                onChange={(e) =>
                  setForm((f) => ({ ...f, workspacePath: e.target.value }))
                }
                placeholder="empty, ., or ./ for repo root"
                helperText="Repo-relative: path/to/dir or ./path/to/dir/"
              />
              <TextField
                label="Filename"
                size="small"
                fullWidth
                value={form.filename}
                onChange={(e) =>
                  setForm((f) => ({ ...f, filename: e.target.value }))
                }
              />
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Delivery</InputLabel>
                <Select
                  label="Delivery"
                  value={form.buildDelivery}
                  onChange={(e) =>
                    onDeliveryChange(e.target.value as BuildDelivery)
                  }
                >
                  <MenuItem value="RAW_FILE">Raw file on disk</MenuItem>
                  <MenuItem value="DOTENV_BUILD_ARGS">
                    Dotenv → Docker build-args
                  </MenuItem>
                </Select>
              </FormControl>
            </Stack>
          ) : (
            <FormControl size="small" fullWidth>
              <InputLabel>Deployment targets</InputLabel>
              <Select
                multiple
                label="Deployment targets"
                value={form.deploymentTargetKeys}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    deploymentTargetKeys:
                      typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value,
                  }))
                }
                renderValue={(selected) => (selected as string[]).join(", ")}
              >
                {targetOptions.map((key) => (
                  <MenuItem key={key} value={key}>
                    {key}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Content input
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={contentMode}
              onChange={setContentInputMode}
            >
              <ToggleButton value="file">File</ToggleButton>
              <ToggleButton value="paste">Paste</ToggleButton>
              <ToggleButton value="per_key" disabled={!perKeyAllowed}>
                Per key
              </ToggleButton>
            </ToggleButtonGroup>
            {!perKeyAllowed && (
              <Typography variant="caption" color="text.secondary">
                Per-key editing is available for RUNTIME and BUILD dotenv
                delivery. RAW_FILE uses file or paste only.
              </Typography>
            )}
          </Stack>

          {contentMode === "file" && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="outlined"
                component="label"
                size="small"
                startIcon={<UploadFileIcon />}
              >
                Pick file
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  onChange={(e) =>
                    void onFilePick(e.target.files?.[0] ?? null)
                  }
                />
              </Button>
              <Typography variant="caption" color="text.secondary">
                Selected file fills the content sent to Vault
                {form.content ? ` (${form.content.length} chars)` : ""}
              </Typography>
            </Stack>
          )}

          {contentMode === "file" && form.content ? (
            <TextField
              label="File content (from upload)"
              size="small"
              fullWidth
              multiline
              minRows={4}
              value={form.content}
              onChange={(e) =>
                setForm((f) => ({ ...f, content: e.target.value }))
              }
            />
          ) : null}

          {contentMode === "paste" && (
            <TextField
              label="File content"
              size="small"
              fullWidth
              multiline
              minRows={4}
              value={form.content}
              onChange={(e) =>
                setForm((f) => ({ ...f, content: e.target.value }))
              }
            />
          )}

          {contentMode === "per_key" && perKeyAllowed && (
            <EnvKeyValueEditor
              rows={keyRows}
              onChange={setKeyRows}
              disabled={busy}
            />
          )}

          <Button variant="contained" disabled={busy} onClick={upload}>
            Upload to Vault
          </Button>
        </Stack>
      </Box>

      <EnvProfileDetailDialog
        open={!!manageProfile}
        projectId={project.id}
        profile={manageProfile}
        busy={busy}
        onClose={() => setManageProfile(null)}
        onSaved={onUpdated}
      />
    </Stack>
  );
}
