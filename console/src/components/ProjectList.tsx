'use client';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import { graphqlRequest } from '@/lib/client';
import { MUTATIONS, QUERIES } from '@/lib/graphql';
import type { Project, ReconcileGitLabProjectsResult } from '@/lib/types';

type ListCategory = 'active' | 'archived';

interface Props {
  selectedId: string | null;
  onSelect: (project: Project) => void;
  refreshToken: number;
  category: ListCategory;
  onCategoryChange: (category: ListCategory) => void;
  onDetected?: () => void;
}

export function ProjectList({
  selectedId,
  onSelect,
  refreshToken,
  category,
  onCategoryChange,
  onDetected,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ projects: Project[] }>(
        QUERIES.projects,
        {
          page: 0,
          perPage: 100,
          filter: { archived: category === 'archived' },
        },
      );
      setProjects(data.projects);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category]);

  const detectFromGitLab = useCallback(async () => {
    setDetecting(true);
    setError(null);
    setDetectMessage(null);
    try {
      const data = await graphqlRequest<{
        reconcileGitLabProjects: ReconcileGitLabProjectsResult;
      }>(MUTATIONS.reconcileGitLabProjects);
      setDetectMessage(data.reconcileGitLabProjects.message);
      if (
        data.reconcileGitLabProjects.backfilled > 0 ||
        data.reconcileGitLabProjects.archivedFromRegistry > 0
      ) {
        onDetected?.();
        await load();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetecting(false);
    }
  }, [onDetected, load]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack sx={{ px: 1.5, pt: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={600}>
            Projects
          </Typography>
          <Stack direction="row" spacing={0.25}>
            <Tooltip title="Detect unregistered GitLab projects (legacy backfill)">
              <span>
                <IconButton
                  size="small"
                  onClick={() => void detectFromGitLab()}
                  disabled={loading || detecting}
                  aria-label="Detect from GitLab"
                >
                  <ManageSearchIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              size="small"
              onClick={() => void load()}
              disabled={loading || detecting}
              aria-label="Refresh"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
        <Tabs
          value={category}
          onChange={(_, v: ListCategory) => onCategoryChange(v)}
          variant="fullWidth"
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
        >
          <Tab label="Active" value="active" />
          <Tab label="Archived" value="archived" />
        </Tabs>
      </Stack>
      {detectMessage && (
        <Alert severity="info" sx={{ mx: 1.5, mb: 1 }} onClose={() => setDetectMessage(null)}>
          {detectMessage}
        </Alert>
      )}
      {error && (
        <Typography color="error" variant="body2" sx={{ px: 2, pb: 1 }}>
          {error}
        </Typography>
      )}
      <List dense sx={{ overflow: 'auto', flex: 1 }}>
        {projects.map((p) => (
          <ListItemButton
            key={p.id}
            selected={p.id === selectedId}
            onClick={() => onSelect(p)}
          >
            <ListItemText
              primary={p.gitlabPath}
              secondary={
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  <Chip label={p.effectiveSlug} size="small" variant="outlined" />
                  {p.archived && (
                    <Chip label="archived" size="small" color="default" variant="filled" />
                  )}
                  {p.capabilities.deployable && (
                    <Chip label="deploy" size="small" color="primary" variant="outlined" />
                  )}
                  {p.legacyV1 && (
                    <Chip label="legacy" size="small" color="warning" variant="outlined" />
                  )}
                </Stack>
              }
              slotProps={{
                primary: { noWrap: true },
                // Chips/Stack render as divs; default secondary Typography is inline (span).
                secondary: { component: 'div' },
              }}
            />
          </ListItemButton>
        ))}
        {!loading && projects.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {category === 'archived'
              ? 'No archived (dangling) projects.'
              : 'No active projects in registry.'}
          </Typography>
        )}
      </List>
    </Paper>
  );
}

export type { ListCategory };
