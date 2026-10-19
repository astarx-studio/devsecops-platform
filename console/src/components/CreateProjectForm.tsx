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
import { useCallback, useEffect, useState } from "react";

import { graphqlRequest } from '@/lib/client';
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { Project, Provisioning } from '@/lib/types';

interface Props {
  onCreated: (project: Project) => void;
}

export function CreateProjectForm({ onCreated }: Props) {
  const [groupPath, setGroupPath] = useState("");
  const [projectSlug, setProjectSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [provisioning, setProvisioning] = useState<Provisioning>('AUTO_DEVOPS');
  const [templateSlug, setTemplateSlug] = useState('');
  const [deployable, setDeployable] = useState(true);
  const [publishable, setPublishable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slugHint, setSlugHint] = useState<string | null>(null);
  const [templates, setTemplates] = useState<
    Array<{ slug: string; description?: string | null }>
  >([]);

  useEffect(() => {
    if (provisioning !== "TEMPLATE") return;
    void graphqlRequest<{
      templates: Array<{ slug: string; description?: string | null }>;
    }>(QUERIES.templates)
      .then((data) => setTemplates(data.templates))
      .catch(() => setTemplates([]));
  }, [provisioning]);

  useEffect(() => {
    const slug = projectSlug.trim();
    if (!slug) {
      setSlugHint(null);
      return;
    }
    const timer = setTimeout(() => {
      void graphqlRequest<{ slugAvailable: boolean }>(QUERIES.slugAvailable, {
        slug,
      })
        .then((data) =>
          setSlugHint(
            data.slugAvailable ? "Slug is available" : "Slug is already taken",
          ),
        )
        .catch(() => setSlugHint(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [projectSlug]);

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
      <Typography
        component="h2"
        variant="subtitle1"
        fontWeight={600}
        gutterBottom
      >
        Create project
      </Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          id="create-group-path"
          label="Group path"
          value={groupPath}
          onChange={(e) => setGroupPath(e.target.value)}
          helperText="Slash-separated group path. Do not include the project slug."
          fullWidth
        />
        <TextField
          label="Project slug"
          value={projectSlug}
          onChange={(e) => setProjectSlug(e.target.value)}
          helperText={
            slugHint ?? "Checked against the registry before you submit"
          }
          fullWidth
        />
        <TextField
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          fullWidth
        />
        <FormControl fullWidth>
          <InputLabel id="create-provisioning-label">Provisioning</InputLabel>
          <Select
            labelId="create-provisioning-label"
            id="create-provisioning"
            label="Provisioning"
            value={provisioning}
            onChange={(e) => setProvisioning(e.target.value as Provisioning)}
          >
            <MenuItem value="AUTO_DEVOPS">AUTO_DEVOPS</MenuItem>
            <MenuItem value="TEMPLATE">TEMPLATE</MenuItem>
          </Select>
        </FormControl>
        {provisioning === "TEMPLATE" && (
          <FormControl fullWidth>
            <InputLabel id="create-template-label">Template</InputLabel>
            <Select
              labelId="create-template-label"
              id="create-template"
              label="Template"
              value={templateSlug}
              onChange={(e) => setTemplateSlug(e.target.value)}
            >
              {templates.map((template) => (
                <MenuItem key={template.slug} value={template.slug}>
                  {template.slug}
                  {template.description ? ` — ${template.description}` : ""}
                </MenuItem>
              ))}
              {templates.length === 0 && (
                <MenuItem value="" disabled>
                  No templates returned
                </MenuItem>
              )}
            </Select>
          </FormControl>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={deployable}
              onChange={(e) => setDeployable(e.target.checked)}
            />
          }
          label="Deployable"
        />
        <FormControlLabel
          control={
            <Switch
              checked={publishable}
              onChange={(e) => setPublishable(e.target.checked)}
            />
          }
          label="Publishable (set at create; cannot be changed later)"
        />
        <Button variant="contained" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </Stack>
    </Paper>
  );
}
