'use client';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';

import { graphqlRequest } from '@/lib/client';
import {
  CLUSTER_PROFILE_OPTIONS,
  clusterProfileLabel,
  normalizeClusterProfile,
} from "@/lib/graphql-enums";
import { MUTATIONS } from '@/lib/graphql';
import type { ClusterProfile, DeploymentTarget, Project } from '@/lib/types';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export function DeploymentTargetPanel({ project, onUpdated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState({
    targetKey: "",
    enabled: true,
    deployRef: "",
    appHost: "",
    kubeNamespace: "",
    clusterProfile: "PROD" as ClusterProfile,
    teardownK8sOnDisable: true,
  });

  const runMutation = useCallback(
    async (fn: () => Promise<Project>) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await fn();
        onUpdated(updated);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onUpdated],
  );

  const openUpsert = (target?: DeploymentTarget) => {
    if (target) {
      setEditingKey(target.key);
      setForm({
        targetKey: target.key,
        enabled: target.enabled,
        deployRef: target.deployRef === "none" ? "" : target.deployRef,
        appHost: target.appHost,
        kubeNamespace: target.kubeNamespace,
        clusterProfile: normalizeClusterProfile(target.clusterProfile),
        teardownK8sOnDisable: true,
      });
    } else {
      setEditingKey(null);
      setForm({
        targetKey: "",
        enabled: true,
        deployRef: "",
        appHost: "",
        kubeNamespace: "",
        clusterProfile: "PROD",
        teardownK8sOnDisable: true,
      });
    }
    setDialogOpen(true);
  };

  const submitUpsert = () => {
    void runMutation(async () => {
      const data = await graphqlRequest<{ upsertDeploymentTarget: Project }>(
        MUTATIONS.upsertDeploymentTarget,
        {
          id: project.id,
          input: {
            targetKey: form.targetKey.trim(),
            enabled: form.enabled,
            deployRef: form.deployRef.trim() || undefined,
            appHost: form.appHost.trim() || undefined,
            kubeNamespace: form.kubeNamespace.trim() || undefined,
            clusterProfile: form.clusterProfile,
            teardownK8sOnDisable: form.teardownK8sOnDisable,
          },
        },
      );
      setDialogOpen(false);
      return data.upsertDeploymentTarget;
    });
  };

  const removeTarget = (targetKey: string) => {
    if (!window.confirm(`Remove deployment target "${targetKey}" and tear down K8s?`)) {
      return;
    }
    void runMutation(async () => {
      const data = await graphqlRequest<{ removeDeploymentTarget: Project }>(
        MUTATIONS.removeDeploymentTarget,
        { id: project.id, targetKey, teardownK8s: true },
      );
      return data.removeDeploymentTarget;
    });
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={600}>
          Deployment targets
        </Typography>
        <Button
          size="small"
          variant="contained"
          onClick={() => openUpsert()}
          disabled={busy}
        >
          Add target
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Key</TableCell>
            <TableCell>Host</TableCell>
            <TableCell>Ref</TableCell>
            <TableCell>NS / cluster</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {project.deploymentTargets.map((t) => (
            <TableRow key={t.key}>
              <TableCell>{t.key}</TableCell>
              <TableCell
                sx={{
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.appHost}
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={t.deployRef}
                  color={t.deployRef === "none" ? "default" : "primary"}
                  variant="outlined"
                />
              </TableCell>
              <TableCell>
                {t.kubeNamespace} / {clusterProfileLabel(t.clusterProfile)}
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={t.enabled ? "enabled" : "disabled"}
                  color={t.enabled ? "success" : "default"}
                />
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={() => openUpsert(t)}
                  disabled={busy}
                >
                  Edit
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => removeTarget(t.key)}
                  disabled={busy}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {form.targetKey
            ? `Target: ${form.targetKey}`
            : "New deployment target"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Target key"
              value={form.targetKey}
              onChange={(e) =>
                setForm((f) => ({ ...f, targetKey: e.target.value }))
              }
              disabled={editingKey !== null}
              helperText="e.g. dev, prod-alt (lowercase, hyphens)"
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, enabled: e.target.checked }))
                  }
                />
              }
              label="Enabled"
            />
            <TextField
              label="Deploy ref (branch)"
              value={form.deployRef}
              onChange={(e) =>
                setForm((f) => ({ ...f, deployRef: e.target.value }))
              }
              helperText='Use API "none" via disabling target — do not enable with ref "none"'
              fullWidth
            />
            <TextField
              label="App host"
              value={form.appHost}
              onChange={(e) =>
                setForm((f) => ({ ...f, appHost: e.target.value }))
              }
              fullWidth
            />
            <TextField
              label="Kube namespace"
              value={form.kubeNamespace}
              onChange={(e) =>
                setForm((f) => ({ ...f, kubeNamespace: e.target.value }))
              }
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Cluster profile</InputLabel>
              <Select
                label="Cluster profile"
                value={form.clusterProfile}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    clusterProfile: e.target.value as ClusterProfile,
                  }))
                }
              >
                {CLUSTER_PROFILE_OPTIONS.map((profile) => (
                  <MenuItem key={profile} value={profile}>
                    {clusterProfileLabel(profile)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={form.teardownK8sOnDisable}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      teardownK8sOnDisable: e.target.checked,
                    }))
                  }
                />
              }
              label="Teardown K8s when disabling"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitUpsert}
            disabled={busy || !form.targetKey.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
