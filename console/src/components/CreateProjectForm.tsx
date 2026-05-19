'use client';
import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';

import { graphqlRequest } from '@/lib/client';
import { MUTATIONS } from '@/lib/graphql';
import type { Project, Provisioning } from '@/lib/types';

interface Props {
  onCreated: (project: Project) => void;
}

export function CreateProjectForm({ onCreated }: Props) {
  const [groupPath, setGroupPath] = useState('system/devsecops-platform/smoke');
  const [projectSlug, setProjectSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [provisioning, setProvisioning] = useState<Provisioning>('AUTO_DEVOPS');
  const [templateSlug, setTemplateSlug] = useState('');
  const [deployable, setDeployable] = useState(true);
  const [publishable, setPublishable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    const segments = groupPath
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segments.length || !projectSlug.trim()) {
      setError('groupPath and projectSlug are required');
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const data = await graphqlRequest<{ createProject: Project }>(
          MUTATIONS.createProject,
          {
            input: {
              groupPath: segments,
              projectSlug: projectSlug.trim(),
              displayName: displayName.trim() || undefined,
              provisioning,
              templateSlug: provisioning === 'TEMPLATE' ? templateSlug.trim() : undefined,
              capabilities: { deployable, publishable },
            },
          },
        );
        onCreated(data.createProject);
        setProjectSlug('');
        setDisplayName('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [
    groupPath,
    projectSlug,
    displayName,
    provisioning,
    templateSlug,
    deployable,
    publishable,
    onCreated,
  ]);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Create project
      </Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Group path (slash-separated, no project slug)"
          value={groupPath}
          onChange={(e) => setGroupPath(e.target.value)}
          fullWidth
        />
        <TextField
          label="Project slug"
          value={projectSlug}
          onChange={(e) => setProjectSlug(e.target.value)}
          fullWidth
        />
        <TextField
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          fullWidth
        />
        <FormControl fullWidth>
          <InputLabel>Provisioning</InputLabel>
          <Select
            label="Provisioning"
            value={provisioning}
            onChange={(e) => setProvisioning(e.target.value as Provisioning)}
          >
            <MenuItem value="AUTO_DEVOPS">AUTO_DEVOPS</MenuItem>
            <MenuItem value="TEMPLATE">TEMPLATE</MenuItem>
          </Select>
        </FormControl>
        {provisioning === 'TEMPLATE' && (
          <TextField
            label="Template slug"
            value={templateSlug}
            onChange={(e) => setTemplateSlug(e.target.value)}
            fullWidth
          />
        )}
        <FormControlLabel
          control={<Switch checked={deployable} onChange={(e) => setDeployable(e.target.checked)} />}
          label="Deployable"
        />
        <FormControlLabel
          control={
            <Switch checked={publishable} onChange={(e) => setPublishable(e.target.checked)} />
          }
          label="Publishable"
        />
        <Button variant="contained" onClick={submit} disabled={busy}>
          Create
        </Button>
      </Stack>
    </Paper>
  );
}
