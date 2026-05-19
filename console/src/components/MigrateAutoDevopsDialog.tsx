'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from '@mui/material';
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

  const submit = useCallback(() => {
    setBusy(true);
    setError(null);
    const branchOptions = buildBranchOptionsInput(branchForm);
    void (async () => {
      try {
        const data = await graphqlRequest<{ migrateProjectToAutoDevops: Project }>(
          MUTATIONS.migrateProjectToAutoDevops,
          {
            id: project.id,
            input: branchOptions ? { branchOptions } : undefined,
          },
        );
        onMigrated(data.migrateProjectToAutoDevops);
        onClose();
        setBranchForm(emptyDeployBranchForm());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [branchForm, project.id, onMigrated, onClose]);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Migrate to Auto DevOps</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {!project.capabilities.deployable && (
            <Alert severity="info">
              This project is not marked deployable — branch settings below affect the pipeline
              trigger only. Enable deploy on the project first (or re-register) to wire dev/stg/prod
              deploy refs.
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
        <Button variant="contained" onClick={submit} disabled={busy}>
          Migrate
        </Button>
      </DialogActions>
    </Dialog>
  );
}
