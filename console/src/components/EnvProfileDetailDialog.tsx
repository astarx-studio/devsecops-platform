"use client";

import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import { EnvKeyValueEditor } from "@/components/EnvKeyValueEditor";
import { graphqlRequest } from "@/lib/client";
import {
  emptyEnvRows,
  entriesToRows,
  serializeEnvRows,
  type EnvKeyValueRow,
} from "@/lib/env-dotenv";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { EnvProfile, EnvProfileContent, Project } from "@/lib/types";

interface Props {
  open: boolean;
  projectId: string;
  profile: EnvProfile | null;
  busy: boolean;
  onClose: () => void;
  onSaved: (project: Project) => void;
}

/** Display path for BUILD profiles (empty stored path = repo root). */
function formatWorkspacePath(workspacePath?: string | null): string {
  if (!workspacePath) {
    return "(repo root)";
  }
  return workspacePath;
}

/**
 * Details dialog: load Vault secrets, edit per-key (dotenv) or textarea (RAW_FILE), save in place.
 */
export function EnvProfileDetailDialog({
  open,
  projectId,
  profile,
  busy,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"DOTENV" | "RAW_FILE">("DOTENV");
  const [rows, setRows] = useState<EnvKeyValueRow[]>(emptyEnvRows());
  const [rawContent, setRawContent] = useState("");
  const [rawRevealed, setRawRevealed] = useState(false);

  const load = useCallback(async () => {
    if (!profile) {
      return;
    }
    setLoading(true);
    setError(null);
    setRawRevealed(false);
    try {
      const data = await graphqlRequest<{
        envProfileContent: EnvProfileContent;
      }>(QUERIES.envProfileContent, {
        projectId,
        profileId: profile.id,
      });
      const content = data.envProfileContent;
      setMode(content.mode);
      if (content.mode === "RAW_FILE") {
        setRawContent(content.rawContent ?? "");
        setRows(emptyEnvRows());
      } else {
        setRows(entriesToRows(content.entries ?? []));
        setRawContent("");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [profile, projectId]);

  useEffect(() => {
    if (open && profile) {
      void load();
    }
  }, [open, profile, load]);

  const handleSave = useCallback(async () => {
    if (!profile) {
      return;
    }
    const content =
      mode === "RAW_FILE" ? rawContent : serializeEnvRows(rows);
    if (!content.trim()) {
      setError(
        mode === "RAW_FILE"
          ? "File content is required."
          : "Add at least one key with a name.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await graphqlRequest(MUTATIONS.updateEnvProfileContent, {
        projectId,
        profileId: profile.id,
        input: { content },
      });
      const refreshed = await graphqlRequest<{ project: Project }>(
        QUERIES.project,
        { id: projectId },
      );
      onSaved(refreshed.project);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [mode, onClose, onSaved, profile, projectId, rawContent, rows]);

  const disabled = busy || loading || saving;

  return (
    <Dialog open={open} onClose={disabled ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {profile ? `Env profile: ${profile.label}` : "Env profile"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {profile && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={profile.injectionPhase} />
              <Chip
                size="small"
                variant="outlined"
                label={`branches: ${profile.branches.join(", ")}`}
              />
              {profile.injectionPhase === "RUNTIME" ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`targets: ${(profile.deploymentTargetKeys ?? []).join(", ") || "—"}`}
                />
              ) : (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${formatWorkspacePath(profile.workspacePath)}/${profile.filename ?? ""} (${profile.buildDelivery ?? "raw"})`}
                />
              )}
              {profile.jobSelector ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`job: ${profile.jobSelector}`}
                />
              ) : null}
            </Stack>
          )}

          <Typography variant="body2" color="text.secondary">
            Values are loaded from Vault for operators. Masked by default — use
            Reveal to show plaintext. Saving replaces this profile&apos;s
            secrets in place.
          </Typography>

          {error && <Alert severity="error">{error}</Alert>}
          {loading && (
            <Typography variant="body2" color="text.secondary">
              Loading secrets…
            </Typography>
          )}

          {!loading && mode === "RAW_FILE" && (
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="flex-end">
                <Tooltip title={rawRevealed ? "Hide content" : "Reveal content"}>
                  <IconButton
                    size="small"
                    disabled={disabled}
                    onClick={() => setRawRevealed((v) => !v)}
                    aria-label={rawRevealed ? "Hide content" : "Reveal content"}
                  >
                    {rawRevealed ? (
                      <VisibilityOffIcon fontSize="small" />
                    ) : (
                      <VisibilityIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </Stack>
              <TextField
                label="File content"
                fullWidth
                multiline
                minRows={8}
                value={rawContent}
                disabled={disabled}
                onChange={(e) => setRawContent(e.target.value)}
                sx={
                  rawRevealed
                    ? undefined
                    : {
                        "& textarea": {
                          WebkitTextSecurity: "disc",
                        },
                      }
                }
              />
            </Stack>
          )}

          {!loading && mode === "DOTENV" && (
            <EnvKeyValueEditor
              rows={rows}
              onChange={setRows}
              maskValues
              disabled={disabled}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={disabled}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={disabled || loading}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
