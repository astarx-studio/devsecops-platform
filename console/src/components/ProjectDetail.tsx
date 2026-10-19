'use client';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

import {
  auditEventLabel,
  formatAuditMetadata,
  formatAuditWhen,
  type AuditLogRow,
} from "@/lib/audit";
import { graphqlRequest } from '@/lib/client';
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { DeleteProjectResult, Project } from '@/lib/types';
import { AppContainerLogPanel } from "./AppContainerLogPanel";
import { ConfirmDialog } from "./ConfirmDialog";
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

type DetailTab = "deployments" | "variables" | "sonar" | "audit" | "app-logs";

const newTabHint = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  width: 1,
} as const;

export function ProjectDetail({ project, onUpdated, onDeleted, onArchived }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('deployments');
  const [links, setLinks] = useState<{
    gitlabBase: string | null;
    vaultUi: string | null;
  } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    void fetch("/api/platform-links")
      .then((res) => res.json())
      .then((body: { gitlabBase: string | null; vaultUi: string | null }) =>
        setLinks(body),
      )
      .catch(() => setLinks(null));
  }, []);

  useEffect(() => {
    if (detailTab !== "audit") return;
    let cancelled = false;
    setAuditLoading(true);
    void graphqlRequest<{ auditLogs: AuditLogRow[] }>(QUERIES.auditLogs, {
      projectId: project.id,
      limit: 8,
    })
      .then((data) => {
        if (cancelled) return;
        setAuditError(null);
        setAuditRows(data.auditLogs);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAuditRows([]);
        setAuditError(err.message);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailTab, project.id, project.updatedAt]);

  useEffect(() => {
    setDetailTab(project.archived ? "app-logs" : "deployments");
  }, [project.id, project.archived]);

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

  const confirmDelete = (
    forceGitLabDelete: boolean,
    skipPlatformCleanup: boolean,
  ) => {
    void run(async () => {
      const data = await graphqlRequest<{ deleteProject: DeleteProjectResult }>(
        MUTATIONS.deleteProject,
        { id: project.id, forceGitLabDelete, skipPlatformCleanup },
      );
      setDeleteOpen(false);
      const result = data.deleteProject;
      if (result.outcome === "DELETED") {
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
    <Paper sx={{ p: 2, height: "100%", overflow: "auto" }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Box>
            <Typography component="h2" variant="h6" fontWeight={600}>
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
              {readOnly ? "Force delete" : "Delete"}
            </Button>
          </Stack>
        </Stack>

        {project.archived && (
          <Alert severity="warning">
            Archived — something was still left (GitLab, Kubernetes, Vault, or
            Sonar). This is not a completed teardown. Retry delete to run
            platform cleanup again.
            {project.gitlabDeleteError && (
              <>
                {" "}
                Last error: <code>{project.gitlabDeleteError}</code>
              </>
            )}
          </Alert>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`slug: ${project.effectiveSlug}`} size="small" />
          <Chip
            label={`helm: ${project.helmReleaseName}`}
            size="small"
            variant="outlined"
          />
          <Chip
            label={
              project.capabilities.deployable ? "deployable" : "not deployable"
            }
            size="small"
            color={project.capabilities.deployable ? "primary" : "default"}
          />
          {project.archived && (
            <Chip label="archived" size="small" color="warning" />
          )}
          {project.legacyV1 && (
            <Chip label="legacy v1" size="small" color="warning" />
          )}
          {project.pinnedV1 && (
            <Chip label="pinned v1" size="small" color="warning" />
          )}
          <Chip
            label={
              project.capabilities.publishable
                ? "publishable (create-time)"
                : "not publishable"
            }
            size="small"
            variant="outlined"
          />
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {links?.gitlabBase && (
            <Link
              href={`${links.gitlabBase}/${project.gitlabPath}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitLab project
              <Box component="span" sx={newTabHint}>
                (opens in a new tab)
              </Box>
            </Link>
          )}
          {links?.vaultUi && (
            <Link
              href={links.vaultUi}
              target="_blank"
              rel="noopener noreferrer"
            >
              Vault UI
              <Box component="span" sx={newTabHint}>
                (opens in a new tab)
              </Box>
            </Link>
          )}
        </Stack>

        <Typography variant="body2">
          Vault path: <code>{project.vaultBasePath}</code>
        </Typography>

        <Stack spacing={0.5}>
          {project.deploymentTargets.flatMap((target) => {
            const hosts = target.apps?.length
              ? target.apps.map((app) => ({ name: app.name, host: app.host }))
              : [{ name: target.key, host: target.appHost }];
            return hosts.map((app) =>
              app.host ? (
                <Link
                  key={`${target.key}-${app.name}`}
                  href={`https://${app.host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                >
                  {target.key}/{app.name}: {app.host}
                  <Box component="span" sx={newTabHint}>
                    (opens in a new tab)
                  </Box>
                </Link>
              ) : null,
            );
          })}
        </Stack>

        {project.legacyV1 && !readOnly && (
          <Button
            size="small"
            variant="text"
            onClick={() => setPinOpen(true)}
            disabled={busy}
          >
            {project.pinnedV1 ? "Unpin v1" : "Pin on v1"}
          </Button>
        )}

        {readOnly && (
          <Typography variant="body2" color="text.secondary">
            Deployment, variable, and Sonar settings are hidden for archived
            projects. Use force delete to remove the GitLab project and
            unregister completely.
          </Typography>
        )}

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flex: 1,
          }}
        >
          <Tabs
            value={detailTab}
            onChange={handleDetailTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="Project settings"
            selectionFollowsFocus
            sx={{
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            {!readOnly && (
              <Tab
                id="project-tab-deployments"
                aria-controls="project-panel-deployments"
                label="Deployments"
                value="deployments"
              />
            )}
            {!readOnly && (
              <Tab
                id="project-tab-variables"
                aria-controls="project-panel-variables"
                label="Variables"
                value="variables"
              />
            )}
            {!readOnly && (
              <Tab
                id="project-tab-sonar"
                aria-controls="project-panel-sonar"
                label="SonarQube"
                value="sonar"
              />
            )}
            <Tab
              id="project-tab-audit"
              aria-controls="project-panel-audit"
              label="Audit"
              value="audit"
            />
            <Tab
              id="project-tab-app-logs"
              aria-controls="project-panel-app-logs"
              label="App logs"
              value="app-logs"
            />
          </Tabs>
          <Box
            role="tabpanel"
            id={`project-panel-${detailTab}`}
            aria-labelledby={`project-tab-${detailTab}`}
            sx={{ pt: 2, flex: 1, minHeight: 0, overflow: "auto" }}
          >
            {detailTab === "deployments" && !readOnly && (
              <DeploymentTargetPanel project={project} onUpdated={onUpdated} />
            )}
            {detailTab === "variables" && !readOnly && (
              <EnvProfilePanel project={project} onUpdated={onUpdated} />
            )}
            {detailTab === "sonar" && !readOnly && (
              <SonarPanel project={project} onUpdated={onUpdated} />
            )}
            {detailTab === "audit" && (
              <Box>
                {auditLoading && (
                  <Typography variant="body2" role="status">
                    Loading audit…
                  </Typography>
                )}
                {auditError && (
                  <Typography variant="body2" color="error" role="alert">
                    {auditError}
                  </Typography>
                )}
                {!auditLoading && !auditError && auditRows.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No audit events for this project yet. The platform Logs tab
                    shows the full trail.
                  </Typography>
                )}
                {auditRows.map((row) => {
                  const details = formatAuditMetadata(row.metadata);
                  return (
                    <Typography key={row.id} variant="body2" display="block">
                      {formatAuditWhen(row.createdAt)} ·{" "}
                      {auditEventLabel(row.eventType)}
                      {row.actor ? ` · ${row.actor}` : ""}
                      {details ? ` · ${details}` : ""}
                    </Typography>
                  );
                })}
              </Box>
            )}
            {detailTab === "app-logs" && (
              <AppContainerLogPanel project={project} />
            )}
          </Box>
        </Box>
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

      <ConfirmDialog
        open={pinOpen}
        title={project.pinnedV1 ? "Unpin v1" : "Pin on v1"}
        message={
          project.pinnedV1
            ? "Unpinning allows Migrate Auto DevOps to run. Migration is refused while pinned."
            : "Pin keeps this legacy project on v1. Migrate will refuse until you unpin."
        }
        confirmLabel={project.pinnedV1 ? "Unpin" : "Pin"}
        typedMatch={project.effectiveSlug}
        busy={busy}
        onClose={() => setPinOpen(false)}
        onConfirm={() => {
          void run(async () => {
            const data = await graphqlRequest<{ setPinnedV1: Project }>(
              MUTATIONS.setPinnedV1,
              {
                id: project.id,
                pinned: !project.pinnedV1,
              },
            );
            setPinOpen(false);
            onUpdated(data.setPinnedV1);
          });
        }}
      />
    </Paper>
  );
}
