'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useCallback, useState } from 'react';

import { DeploymentTargetDialog } from "@/components/DeploymentTargetDialog";
import { graphqlRequest } from '@/lib/client';
import {
  resolveAppsForSubmit,
  targetFormFromProject,
  type TargetFormState,
} from "@/lib/deployment-target-form";
import { clusterProfileLabel } from "@/lib/graphql-enums";
import { MUTATIONS } from '@/lib/graphql';
import type {
  DeploymentTarget,
  Project,
  UpsertDeploymentTargetResult,
} from "@/lib/types";

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export function DeploymentTargetPanel({ project, onUpdated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [ciWarning, setCiWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<TargetFormState>(() =>
    targetFormFromProject(project.effectiveSlug),
  );

  const appsDomain = project.appsDomain || "apps.example.com";

  const runMutation = useCallback(
    async (fn: () => Promise<Project>) => {
      setBusy(true);
      setError(null);
      setCiWarning(null);
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
    setEditingKey(target?.key ?? null);
    setForm(targetFormFromProject(project.effectiveSlug, target));
    setCiWarning(null);
    setDialogOpen(true);
  };

  const submitUpsert = useCallback(() => {
    void runMutation(async () => {
      const apps = resolveAppsForSubmit(form, appsDomain);
      const data = await graphqlRequest<{
        upsertDeploymentTarget: UpsertDeploymentTargetResult;
      }>(MUTATIONS.upsertDeploymentTarget, {
        id: project.id,
        input: {
          targetKey: form.targetKey.trim(),
          enabled: form.enabled,
          deployRef: form.deployRef.trim() || undefined,
          kubeNamespace: form.kubeNamespace.trim() || undefined,
          clusterProfile: form.clusterProfile,
          teardownK8sOnDisable: form.teardownK8sOnDisable,
          apps,
        },
      });
      const warnings = data.upsertDeploymentTarget.ciSyncWarnings ?? [];
      if (warnings.length > 0) {
        setCiWarning(warnings.join(" "));
      }
      setDialogOpen(false);
      return data.upsertDeploymentTarget.project;
    });
  }, [runMutation, form, appsDomain, project.id]);

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

  const formatAppsSummary = (target: DeploymentTarget) => {
    const apps = target.apps ?? [];
    if (apps.length === 0) {
      return target.appHost;
    }
    if (apps.length === 1) {
      return apps[0].host;
    }
    return `${apps[0].host} (+${apps.length - 1} apps)`;
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
      {ciWarning && (
        <Alert severity="warning" onClose={() => setCiWarning(null)}>
          {ciWarning}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Key</TableCell>
            <TableCell>Apps / host</TableCell>
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
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {formatAppsSummary(t)}
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

      <DeploymentTargetDialog
        open={dialogOpen}
        editingKey={editingKey}
        form={form}
        appsDomain={appsDomain}
        effectiveSlug={project.effectiveSlug}
        busy={busy}
        onClose={() => setDialogOpen(false)}
        onChange={setForm}
        onSave={submitUpsert}
      />
    </Stack>
  );
}
