'use client';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  FormControlLabel,
  TextField,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from "@mui/material";
import { useCallback, useState } from 'react';

import { graphqlRequest } from '@/lib/client';
import { MUTATIONS } from '@/lib/graphql';
import type { Project } from '@/lib/types';
import {
  buildBranchOptionsInput,
  DeployBranchFields,
  emptyDeployBranchForm,
} from './DeployBranchFields';

interface Props {
  project: Project;
  open: boolean;
  onClose: () => void;
  onMigrated: (project: Project) => void;
}

export function MigrateAutoDevopsDialog({ project, open, onClose, onMigrated }: Props) {
  const [branchForm, setBranchForm] = useState(emptyDeployBranchForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unpin, setUnpin] = useState(false);
  const [typed, setTyped] = useState("");

  const submit = useCallback(() => {
    setBusy(true);
    setError(null);
    const branchOptions = buildBranchOptionsInput(branchForm);
    void (async () => {
      try {
        const data = await graphqlRequest<{
          migrateProjectToAutoDevops: Project;
        }>(MUTATIONS.migrateProjectToAutoDevops, {
          id: project.id,
          input: {
            ...(branchOptions ? { branchOptions } : {}),
            ...(unpin ? { unpin: true } : {}),
          },
        });
        onMigrated(data.migrateProjectToAutoDevops);
        onClose();
        setBranchForm(emptyDeployBranchForm());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [branchForm, unpin, project.id, project.pinnedV1, onMigrated, onClose]);

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Migrate to Auto DevOps</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {project.pinnedV1 && (
            <Alert severity="warning">
              This project is pinned to v1. Migration is refused until you
              confirm unpin.
            </Alert>
          )}
          {project.pinnedV1 && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={unpin}
                  onChange={(e) => setUnpin(e.target.checked)}
                />
              }
              label="Unpin and migrate"
            />
          )}
          {project.pinnedV1 && (
            <TextField
              label={`Type ${project.effectiveSlug} to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              fullWidth
              disabled={busy}
            />
          )}
          {!project.capabilities.deployable && (
            <Alert severity="info">
              This project is not marked deployable — branch settings below
              affect the pipeline trigger only. Enable deploy on the project
              first (or re-register) to wire dev/stg/prod deploy refs.
            </Alert>
          )}
          <DeployBranchFields
            showPerEnv
            state={branchForm}
            onChange={setBranchForm}
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={
            busy ||
            (project.pinnedV1 &&
              (!unpin || typed.trim() !== project.effectiveSlug))
          }
        >
          {busy ? "Migrating…" : "Migrate"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
