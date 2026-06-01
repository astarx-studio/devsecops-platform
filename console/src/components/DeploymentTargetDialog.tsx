"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useMemo, type ChangeEvent, type MouseEvent } from "react";

import type { SelectChangeEvent } from "@mui/material/Select";

import {
  CLUSTER_PROFILE_OPTIONS,
  clusterProfileLabel,
  normalizeClusterProfile,
} from "@/lib/graphql-enums";
import {
  createDefaultAppRow,
  deriveAppHostPreview,
  type AppRowForm,
  type TargetFormState,
} from "@/lib/deployment-target-form";
import type { ClusterProfile } from "@/lib/types";

interface Props {
  open: boolean;
  editingKey: string | null;
  form: TargetFormState;
  appsDomain: string;
  effectiveSlug: string;
  busy: boolean;
  onClose: () => void;
  onChange: (form: TargetFormState) => void;
  onSave: () => void;
}

export function DeploymentTargetDialog({
  open,
  editingKey,
  form,
  appsDomain,
  effectiveSlug,
  busy,
  onClose,
  onChange,
  onSave,
}: Props) {
  const updateApp = useCallback(
    (id: string, patch: Partial<AppRowForm>) => {
      onChange({
        ...form,
        apps: form.apps.map((row) =>
          row.id === id ? { ...row, ...patch } : row,
        ),
      });
    },
    [form, onChange],
  );

  const onTargetKeyChange = useCallback(
    (targetKey: string) => {
      onChange({
        ...form,
        targetKey,
        apps: form.apps.map((row) =>
          row.hostOverridden
            ? row
            : {
                ...row,
                host: "",
              },
        ),
      });
    },
    [form, onChange],
  );

  const onAppNameChange = useCallback(
    (id: string, name: string) => {
      const row = form.apps.find((a) => a.id === id);
      if (!row) {
        return;
      }
      const patch: Partial<AppRowForm> = { name };
      if (row.imageAuto) {
        patch.image = name;
      }
      updateApp(id, patch);
    },
    [form.apps, updateApp],
  );

  const addApp = useCallback(() => {
    const next = createDefaultAppRow("", false);
    onChange({
      ...form,
      monorepoMode: true,
      apps: form.monorepoMode
        ? [...form.apps, next]
        : form.apps
            .map((row) => ({ ...row, isDefault: false, expanded: true }))
            .concat(next),
    });
  }, [form, onChange]);

  const removeApp = useCallback(
    (id: string) => {
      const remaining = form.apps.filter((a) => a.id !== id);
      if (remaining.length === 0) {
        return;
      }
      const monorepoMode = remaining.length > 1;
      onChange({
        ...form,
        monorepoMode,
        apps: remaining.map((row, index) => ({
          ...row,
          isDefault: !monorepoMode && index === 0,
        })),
      });
    },
    [form, onChange],
  );

  const hostHints = useMemo(
    () =>
      form.apps.map((row) =>
        deriveAppHostPreview(
          row.name || effectiveSlug,
          form.targetKey,
          appsDomain,
        ),
      ),
    [form.apps, form.targetKey, appsDomain, effectiveSlug],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {editingKey ? `Edit target: ${editingKey}` : "New deployment target"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Target key"
              value={form.targetKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onTargetKeyChange(e.target.value)
              }
              disabled={editingKey !== null}
              helperText="e.g. dev, prod-alt (lowercase, hyphens)"
              fullWidth
            />
            <TextField
              label="Deploy ref (branch)"
              value={form.deployRef}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange({ ...form, deployRef: e.target.value })
              }
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Kube namespace"
              value={form.kubeNamespace}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange({ ...form, kubeNamespace: e.target.value })
              }
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Cluster profile</InputLabel>
              <Select
                label="Cluster profile"
                value={form.clusterProfile}
                onChange={(e: SelectChangeEvent) =>
                  onChange({
                    ...form,
                    clusterProfile: normalizeClusterProfile(
                      e.target.value,
                    ) as ClusterProfile,
                  })
                }
              >
                {CLUSTER_PROFILE_OPTIONS.map((profile) => (
                  <MenuItem key={profile} value={profile}>
                    {clusterProfileLabel(profile)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" flexWrap="wrap" gap={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(_e, checked) =>
                    onChange({ ...form, enabled: checked })
                  }
                />
              }
              label="Enabled"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.teardownK8sOnDisable}
                  onChange={(_e, checked) =>
                    onChange({ ...form, teardownK8sOnDisable: checked })
                  }
                />
              }
              label="Teardown K8s when disabling"
            />
          </Stack>

          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              mb={1}
            >
              <Typography variant="subtitle2" fontWeight={600}>
                App builds
              </Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={addApp}
                disabled={busy}
              >
                Add app
              </Button>
            </Stack>
            <Stack spacing={1}>
              {form.apps.map((row, index) => {
                const canRemove = form.monorepoMode || form.apps.length > 1;
                const label =
                  row.name.trim() ||
                  (row.isDefault ? effectiveSlug : "new app");
                return (
                  <Box
                    key={row.id}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ px: 1.5, py: 1, cursor: "pointer" }}
                      onClick={() =>
                        updateApp(row.id, { expanded: !row.expanded })
                      }
                    >
                      <ExpandMoreIcon
                        sx={{
                          transform: row.expanded
                            ? "rotate(0deg)"
                            : "rotate(-90deg)",
                          transition: "transform 0.15s",
                        }}
                        fontSize="small"
                      />
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {label}
                      </Typography>
                      {row.isDefault && !form.monorepoMode && (
                        <Chip label="default" size="small" variant="outlined" />
                      )}
                      {canRemove && (
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e: MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            removeApp(row.id);
                          }}
                          aria-label="Remove app"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                    <Collapse in={row.expanded}>
                      <Stack spacing={1.5} sx={{ px: 2, pb: 2, pt: 0.5 }}>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1.5}
                        >
                          <TextField
                            label="App name"
                            value={row.name}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              onAppNameChange(row.id, e.target.value)
                            }
                            fullWidth
                            size="small"
                          />
                          <TextField
                            label="Dockerfile path"
                            value={row.dockerfile}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateApp(row.id, { dockerfile: e.target.value })
                            }
                            placeholder="Dockerfile"
                            fullWidth
                            size="small"
                          />
                        </Stack>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1.5}
                        >
                          <TextField
                            label="Image name"
                            value={row.image}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateApp(row.id, {
                                image: e.target.value,
                                imageAuto: false,
                              })
                            }
                            fullWidth
                            size="small"
                          />
                          <TextField
                            label="App host"
                            value={row.hostOverridden ? row.host : ""}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateApp(row.id, {
                                host: e.target.value,
                                hostOverridden: true,
                              })
                            }
                            placeholder="auto"
                            helperText={`→ ${hostHints[index]}`}
                            fullWidth
                            size="small"
                          />
                        </Stack>
                      </Stack>
                    </Collapse>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={
            busy ||
            !form.targetKey.trim() ||
            form.apps.some((a) => !a.name.trim() || !a.image.trim())
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
