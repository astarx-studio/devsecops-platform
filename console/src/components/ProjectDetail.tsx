'use client';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

import { graphqlRequest } from '@/lib/client';
import { MUTATIONS } from '@/lib/graphql';
import type { DeleteProjectResult, Project } from '@/lib/types';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { DeploymentTargetPanel } from './DeploymentTargetPanel';
import { EnvProfilePanel } from './EnvProfilePanel';
import { MigrateAutoDevopsDialog } from './MigrateAutoDevopsDialog';
import { SonarPanel } from './SonarPanel';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
  onDeleted: () => void;
  onArchived: (project: Project) => void;
}

type DetailTab = 'deployments' | 'variables' | 'sonar';

export function ProjectDetail({ project, onUpdated, onDeleted, onArchived }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('deployments');

  useEffect(() => {
    setDetailTab('deployments');
  }, [project.id]);

  const handleDetailTabChange = useCallback(
    (_: SyntheticEvent, value: DetailTab) => setDetailTab(value),
    [],
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const confirmDelete = (forceGitLabDelete: boolean) => {
    void run(async () => {
      const data = await graphqlRequest<{ deleteProject: DeleteProjectResult }>(
        MUTATIONS.deleteProject,
        { id: project.id, forceGitLabDelete },
      );
      setDeleteOpen(false);
      const result = data.deleteProject;
      if (result.outcome === 'DELETED') {
        onDeleted();
        return;
      }
      if (result.project) {
        onArchived(result.project);
      }
    });
  };

  const readOnly = project.archived;

  return (
    <Paper sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {project.gitlabPath}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Mongo ID: {project.id} · GitLab ID: {project.gitlabProjectId}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            {project.legacyV1 && !readOnly && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<RocketLaunchIcon />}
                onClick={() => setMigrateOpen(true)}
                disabled={busy}
              >
                Migrate Auto DevOps
              </Button>
            )}
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setDeleteOpen(true)}
              disabled={busy}
            >
              {readOnly ? 'Force delete' : 'Delete'}
            </Button>
          </Stack>
        </Stack>

        {project.archived && (
          <Alert severity="warning">
            Archived — platform resources were removed but the GitLab project may still exist.
            {project.gitlabDeleteError && (
              <>
                {' '}
                Last error: <code>{project.gitlabDeleteError}</code>
              </>
            )}
          </Alert>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`slug: ${project.effectiveSlug}`} size="small" />
          <Chip label={`helm: ${project.helmReleaseName}`} size="small" variant="outlined" />
          <Chip
            label={project.capabilities.deployable ? 'deployable' : 'not deployable'}
            size="small"
            color={project.capabilities.deployable ? 'primary' : 'default'}
          />
          {project.archived && <Chip label="archived" size="small" color="warning" />}
          {project.legacyV1 && <Chip label="legacy v1" size="small" color="warning" />}
        </Stack>

        <Typography variant="body2">
          Vault: <code>{project.vaultBasePath}</code>
        </Typography>

        {!readOnly && (
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <Tabs
              value={detailTab}
              onChange={handleDetailTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                borderBottom: 1,
                borderColor: 'divider',
                minHeight: 40,
                '& .MuiTab-root': { minHeight: 40, py: 1, textTransform: 'none' },
              }}
            >
              <Tab label="Deployments" value="deployments" />
              <Tab label="Variables" value="variables" />
              <Tab label="SonarQube" value="sonar" />
            </Tabs>
            <Box sx={{ pt: 2, flex: 1, minHeight: 0, overflow: 'auto' }}>
              {detailTab === 'deployments' && (
                <DeploymentTargetPanel project={project} onUpdated={onUpdated} />
              )}
              {detailTab === 'variables' && (
                <EnvProfilePanel project={project} onUpdated={onUpdated} />
              )}
              {detailTab === 'sonar' && <SonarPanel project={project} onUpdated={onUpdated} />}
            </Box>
          </Box>
        )}

        {readOnly && (
          <Typography variant="body2" color="text.secondary">
            Deployment, variable, and Sonar settings are hidden for archived projects. Use force
            delete to remove the GitLab project and unregister completely.
          </Typography>
        )}
      </Stack>

      <DeleteProjectDialog
        open={deleteOpen}
        archived={project.archived}
        gitlabPath={project.gitlabPath}
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />

      <MigrateAutoDevopsDialog
        project={project}
        open={migrateOpen}
        onClose={() => setMigrateOpen(false)}
        onMigrated={onUpdated}
      />
    </Paper>
  );
}
