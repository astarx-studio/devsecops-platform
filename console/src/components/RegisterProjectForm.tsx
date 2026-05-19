'use client';
import {
  Alert,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
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
  onRegistered: (project: Project) => void;
}

export function RegisterProjectForm({ onRegistered }: Props) {
  const [gitlabProjectId, setGitlabProjectId] = useState('');
  const [deployable, setDeployable] = useState(true);
  const [branchForm, setBranchForm] = useState(emptyDeployBranchForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    const id = Number.parseInt(gitlabProjectId, 10);
    if (!Number.isFinite(id)) {
      setError('GitLab project ID must be a number');
      return;
    }
    setBusy(true);
    setError(null);
    const branchOptions = buildBranchOptionsInput(branchForm);
    void (async () => {
      try {
        const data = await graphqlRequest<{ registerGitLabProject: Project }>(
          MUTATIONS.registerGitLabProject,
          {
            input: {
              gitlabProjectId: id,
              capabilities: { deployable, publishable: false },
              ...(branchOptions ? { branchOptions } : {}),
            },
          },
        );
        onRegistered(data.registerGitLabProject);
        setGitlabProjectId('');
        setBranchForm(emptyDeployBranchForm());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [gitlabProjectId, deployable, branchForm, onRegistered]);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Register existing GitLab project
      </Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="GitLab project ID"
          value={gitlabProjectId}
          onChange={(e) => setGitlabProjectId(e.target.value)}
          type="number"
          fullWidth
        />
        <FormControlLabel
          control={<Switch checked={deployable} onChange={(e) => setDeployable(e.target.checked)} />}
          label="Wire deploy (Vault, CI, targets)"
        />
        {deployable && (
          <DeployBranchFields
            showPerEnv
            state={branchForm}
            onChange={setBranchForm}
            disabled={busy}
          />
        )}
        <Button variant="contained" onClick={submit} disabled={busy}>
          Register
        </Button>
      </Stack>
    </Paper>
  );
}
