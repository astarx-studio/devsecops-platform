"use client";

import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Link,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

import {
  auditEventLabel,
  formatAuditMetadata,
  formatAuditWhen,
  type AuditLogRow,
} from "@/lib/audit";
import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { DeleteProjectResult, Project } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { DeploymentTargetPanel } from "./DeploymentTargetPanel";
import { MigrateAutoDevopsDialog } from "./MigrateAutoDevopsDialog";
import { PanelFallback } from "./PanelFallback";

const EnvProfilePanel = dynamic(
  () => import("./EnvProfilePanel").then((mod) => mod.EnvProfilePanel),
  { loading: () => <PanelFallback label="variables" /> },
);
const SonarPanel = dynamic(
  () => import("./SonarPanel").then((mod) => mod.SonarPanel),
  { loading: () => <PanelFallback label="Sonar" /> },
);
const AppContainerLogPanel = dynamic(
  () => import("./AppContainerLogPanel").then((mod) => mod.AppContainerLogPanel),
  { loading: () => <PanelFallback label="app logs" /> },
);

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
  top: 0,
  left: 0,
  width: 1,
} as const;

function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ProjectDetail({ project, onUpdated, onDeleted, onArchived }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("deployments");
  const [links, setLinks] = useState<{ gitlabBase: string | null; vaultUi: string | null } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [actionsAnchor, setActionsAnchor] = useState<HTMLElement | null>(null);
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    void fetch("/api/platform-links")
      .then((response) => response.json())
      .then((body: { gitlabBase: string | null; vaultUi: string | null }) => setLinks(body))
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
    setActionsAnchor(null);
  }, [project.id, project.archived]);

  const handleDetailTabChange = useCallback(
    (_: SyntheticEvent, value: DetailTab) => setDetailTab(value),
    [],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmDelete = (forceGitLabDelete: boolean, skipPlatformCleanup: boolean) => {
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
      if (result.project) onArchived(result.project);
    });
  };

  const readOnly = project.archived;
  const metadata = [
    { label: "Project slug", value: project.effectiveSlug, mono: true },
    { label: "Provisioning", value: project.provisioning === "AUTO_DEVOPS" ? "Auto DevOps" : project.templateSlug || "Template" },
    { label: "Deployment targets", value: String(project.deploymentTargets.length) },
    { label: "Variable profiles", value: String(project.envProfiles?.length ?? 0) },
    { label: "Helm release", value: project.helmReleaseName, mono: true },
    { label: "Last updated", value: formatProjectDate(project.updatedAt) },
  ];
  const applicationHosts = project.deploymentTargets.flatMap((target) => {
    const hosts = target.apps?.length
      ? target.apps.map((app) => ({ name: app.name, host: app.host }))
      : [{ name: target.key, host: target.appHost }];
    return hosts.filter((app) => Boolean(app.host)).map((app) => ({ ...app, target: target.key }));
  });

  return (
    <Paper variant="outlined" sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction={{ xs: "column", xl: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xl: "flex-start" }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography component="h2" variant="h5" noWrap>
                {project.displayName || project.effectiveSlug}
              </Typography>
              <Chip
                size="small"
                color={project.archived ? "warning" : "success"}
                variant="outlined"
                label={project.archived ? "Archived" : "Active"}
              />
              {project.legacyV1 && <Chip size="small" color="warning" variant="outlined" label="Legacy v1" />}
              {project.pinnedV1 && <Chip size="small" variant="outlined" label="Pinned" />}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, wordBreak: "break-word" }}>
              {project.gitlabPath}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            {links?.gitlabBase && (
              <Button
                component="a"
                href={`${links.gitlabBase}/${project.gitlabPath}`}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                variant="outlined"
                startIcon={<CodeOutlinedIcon />}
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              >
                GitLab
                <Box component="span" sx={newTabHint}>(opens in a new tab)</Box>
              </Button>
            )}
            {links?.vaultUi && (
              <Button
                component="a"
                href={links.vaultUi}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                variant="outlined"
                startIcon={<KeyOutlinedIcon />}
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              >
                Vault
                <Box component="span" sx={newTabHint}>(opens in a new tab)</Box>
              </Button>
            )}
            {project.legacyV1 && !readOnly && (
              <Button size="small" variant="contained" startIcon={<RocketLaunchIcon />} onClick={() => setMigrateOpen(true)} disabled={busy}>
                Migrate
              </Button>
            )}
            <IconButton aria-label="Project actions" onClick={(event) => setActionsAnchor(event.currentTarget)} disabled={busy}>
              <MoreVertIcon />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))", xl: "repeat(6, minmax(0, 1fr))" },
          bgcolor: "#f4f7f7",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {metadata.map((item) => (
          <Box key={item.label} sx={{ px: 2, py: 1.5, minWidth: 0, borderRight: { xl: "1px solid" }, borderColor: "divider" }}>
            <Typography variant="caption" color="text.secondary" display="block">
              {item.label}
            </Typography>
            <Typography
              variant="body2"
              fontWeight={500}
              noWrap
              title={item.value}
              sx={{ mt: 0.25, fontFamily: item.mono ? '"IBM Plex Mono", monospace' : undefined, fontSize: item.mono ? 12.5 : undefined }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {(project.archived || error) && (
        <Stack spacing={1} sx={{ p: 2, pb: 0 }}>
          {project.archived && (
            <Alert severity="warning">
              Cleanup did not complete. GitLab, Kubernetes, Vault, or Sonar resources may remain; retry deletion to finish teardown.
              {project.gitlabDeleteError && <> Last error: <code>{project.gitlabDeleteError}</code></>}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      )}

      <Tabs
        value={detailTab}
        onChange={handleDetailTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Project settings"
        selectionFollowsFocus
        sx={{ borderBottom: 1, borderColor: "divider", px: 1, flexShrink: 0 }}
      >
        {!readOnly && <Tab id="project-tab-deployments" aria-controls="project-panel-deployments" label="Deployments" value="deployments" />}
        {!readOnly && <Tab id="project-tab-variables" aria-controls="project-panel-variables" label="Variables" value="variables" />}
        {!readOnly && <Tab id="project-tab-sonar" aria-controls="project-panel-sonar" label="SonarQube" value="sonar" />}
        <Tab id="project-tab-audit" aria-controls="project-panel-audit" label="Audit" value="audit" />
        <Tab id="project-tab-app-logs" aria-controls="project-panel-app-logs" label="App logs" value="app-logs" />
      </Tabs>

      <Box
        role="tabpanel"
        id={`project-panel-${detailTab}`}
        aria-labelledby={`project-tab-${detailTab}`}
        sx={{ p: { xs: 2, md: 2.5 }, flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {readOnly && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Deployment, variable, and Sonar settings are unavailable for archived projects. Use Force delete in project actions to complete removal.
          </Typography>
        )}
        {detailTab === "deployments" && !readOnly && (
          <Stack spacing={2.5}>
            {applicationHosts.length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>Application endpoints</Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {applicationHosts.map((app) => (
                    <Link key={`${app.target}-${app.name}`} href={`https://${app.host}`} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ display: "inline-flex", alignItems: "center", gap: 0.4 }}>
                      {app.target}/{app.name}
                      <OpenInNewIcon sx={{ fontSize: 13 }} />
                      <Box component="span" sx={newTabHint}>(opens in a new tab)</Box>
                    </Link>
                  ))}
                </Stack>
              </Box>
            )}
            <DeploymentTargetPanel project={project} onUpdated={onUpdated} />
          </Stack>
        )}
        {detailTab === "variables" && !readOnly && <EnvProfilePanel project={project} onUpdated={onUpdated} />}
        {detailTab === "sonar" && !readOnly && <SonarPanel project={project} onUpdated={onUpdated} />}
        {detailTab === "audit" && (
          <Box>
            <Typography variant="h6" component="h3" sx={{ mb: 0.5 }}>Project activity</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Latest registry and configuration events for this project.</Typography>
            {auditLoading && <Typography variant="body2" role="status">Loading audit events…</Typography>}
            {auditError && <Alert severity="error">{auditError}</Alert>}
            {!auditLoading && !auditError && auditRows.length === 0 && (
              <Typography variant="body2" color="text.secondary">No audit events for this project yet. The platform audit log contains the full trail.</Typography>
            )}
            {auditRows.map((row, index) => {
              const details = formatAuditMetadata(row.metadata);
              return (
                <Box key={row.id}>
                  {index > 0 && <Divider sx={{ my: 1.5 }} />}
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Box sx={{ width: 8, height: 8, mt: 0.75, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" fontWeight={600}>{auditEventLabel(row.eventType)}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {formatAuditWhen(row.createdAt)}{row.actor ? ` · ${row.actor}` : ""}
                      </Typography>
                      {details && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{details}</Typography>}
                    </Box>
                  </Stack>
                </Box>
              );
            })}
          </Box>
        )}
        {detailTab === "app-logs" && <AppContainerLogPanel project={project} />}
      </Box>

      <Menu
        anchorEl={actionsAnchor}
        open={Boolean(actionsAnchor)}
        onClose={() => setActionsAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {project.legacyV1 && !readOnly && (
          <MenuItem onClick={() => { setActionsAnchor(null); setPinOpen(true); }}>
            <ListItemIcon><PushPinOutlinedIcon fontSize="small" /></ListItemIcon>
            {project.pinnedV1 ? "Unpin v1" : "Pin on v1"}
          </MenuItem>
        )}
        <MenuItem onClick={() => { setActionsAnchor(null); setDeleteOpen(true); }} sx={{ color: "error.main" }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          {readOnly ? "Force delete project" : "Delete project"}
        </MenuItem>
      </Menu>

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
        message={project.pinnedV1 ? "Unpinning allows Migrate Auto DevOps to run. Migration is refused while pinned." : "Pin keeps this legacy project on v1. Migrate will refuse until you unpin."}
        confirmLabel={project.pinnedV1 ? "Unpin" : "Pin"}
        typedMatch={project.effectiveSlug}
        busy={busy}
        onClose={() => setPinOpen(false)}
        onConfirm={() => {
          void run(async () => {
            const data = await graphqlRequest<{ setPinnedV1: Project }>(MUTATIONS.setPinnedV1, {
              id: project.id,
              pinned: !project.pinnedV1,
            });
            setPinOpen(false);
            onUpdated(data.setPinnedV1);
          });
        }}
      />
    </Paper>
  );
}
