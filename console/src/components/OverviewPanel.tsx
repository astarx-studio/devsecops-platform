"use client";

import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import type { ConsoleSection } from "@/lib/console-sections";
import { QUERIES } from "@/lib/graphql";
import type { Project } from "@/lib/types";
import { useHealth } from "@/context/HealthContext";

interface OverviewPanelProps {
  refreshToken: number;
  onNavigate: (section: ConsoleSection) => void;
  onSelectProject: (project: Project) => void;
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function healthLabel(value: string | undefined) {
  if (!value) return "Not checked";
  return value.toLowerCase() === "ok" ? "Operational" : value;
}

export function OverviewPanel({
  refreshToken,
  onNavigate,
  onSelectProject,
}: OverviewPanelProps) {
  const [active, setActive] = useState<Project[]>([]);
  const [archived, setArchived] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { health, refreshing, refreshHealth } = useHealth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeData, archivedData] = await Promise.all([
        graphqlRequest<{ projects: Project[] }>(QUERIES.projects, {
          page: 0,
          perPage: 100,
          filter: { archived: false },
        }),
        graphqlRequest<{ projects: Project[] }>(QUERIES.projects, {
          page: 0,
          perPage: 100,
          filter: { archived: true },
        }),
      ]);
      setActive(activeData.projects);
      setArchived(archivedData.projects);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const summary = useMemo(() => {
    const targets = active.reduce(
      (total, project) => total + project.deploymentTargets.length,
      0,
    );
    const variables = active.reduce(
      (total, project) => total + (project.envProfiles?.length ?? 0),
      0,
    );
    const deployable = active.filter((project) => project.capabilities.deployable).length;
    const legacy = active.filter((project) => project.legacyV1);
    const recent = [...active].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    return {
      targets,
      variables,
      deployable,
      legacy,
      recent,
      attention: [...archived, ...legacy],
    };
  }, [active, archived]);

  const metrics = [
    {
      label: "Active projects",
      value: active.length,
      detail: `${archived.length} archived`,
      icon: FolderOutlinedIcon,
      action: () => onNavigate("projects"),
    },
    {
      label: "Deployment targets",
      value: summary.targets,
      detail: `${summary.deployable} deployable projects`,
      icon: RocketLaunchOutlinedIcon,
      action: () => onNavigate("projects"),
    },
    {
      label: "Variable profiles",
      value: summary.variables,
      detail: "Across active projects",
      icon: KeyOutlinedIcon,
      action: () => onNavigate("projects"),
    },
    {
      label: "Needs attention",
      value: summary.attention.length,
      detail: `${summary.legacy.length} legacy · ${archived.length} archived`,
      icon: WarningAmberOutlinedIcon,
      action: () => onNavigate("projects"),
    },
  ];

  return (
    <Stack spacing={3}>
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          Could not load the project overview. {error}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Paper key={metric.label} variant="outlined" sx={{ overflow: "hidden" }}>
              <ButtonBase
                onClick={metric.action}
                sx={{
                  width: "100%",
                  minHeight: 148,
                  p: 2.25,
                  display: "block",
                  textAlign: "left",
                  "&:hover": { bgcolor: "rgba(15,107,99,0.035)" },
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    {metric.label}
                  </Typography>
                  <Icon sx={{ fontSize: 21, color: "text.secondary" }} />
                </Stack>
                {loading ? (
                  <Skeleton width={72} height={48} sx={{ mt: 0.5 }} />
                ) : (
                  <Typography sx={{ mt: 0.5, fontSize: 34, lineHeight: 1.25, fontWeight: 600, letterSpacing: -0.8 }}>
                    {metric.value}
                  </Typography>
                )}
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.75 }}>
                  <Typography variant="caption" color="text.secondary">
                    {metric.detail}
                  </Typography>
                  <ArrowForwardIcon sx={{ fontSize: 16, color: "primary.main" }} />
                </Stack>
              </ButtonBase>
            </Paper>
          );
        })}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1.55fr) minmax(300px, 1fr)" },
          gap: 2,
          alignItems: "start",
        }}
      >
        <Paper variant="outlined">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2.5, py: 2 }}>
            <Box>
              <Typography variant="h6" component="h2">Recently updated</Typography>
              <Typography variant="body2" color="text.secondary">
                Active projects ordered by their latest registry change
              </Typography>
            </Box>
            <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => onNavigate("projects")}>
              View all
            </Button>
          </Stack>
          <Divider />
          {loading ? (
            <Stack spacing={2} sx={{ p: 2.5 }}>
              {[0, 1, 2, 3].map((item) => <Skeleton key={item} height={40} />)}
            </Stack>
          ) : summary.recent.length === 0 ? (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 3, textAlign: "center" }}>
              <FolderOutlinedIcon color="disabled" sx={{ fontSize: 34 }} />
              <Typography fontWeight={500}>No active projects yet</Typography>
              <Typography variant="body2" color="text.secondary">
                Create a project or register an existing GitLab repository to get started.
              </Typography>
              <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => onNavigate("create")}>
                Create project
              </Button>
            </Stack>
          ) : (
            summary.recent.slice(0, 5).map((project, index) => (
              <Box key={project.id}>
                {index > 0 && <Divider />}
                <ButtonBase
                  onClick={() => onSelectProject(project)}
                  sx={{ width: "100%", px: 2.5, py: 1.75, textAlign: "left", "&:hover": { bgcolor: "rgba(15,107,99,0.035)" } }}
                >
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ width: "100%", minWidth: 0 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {project.displayName || project.effectiveSlug}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {project.gitlabPath}
                      </Typography>
                    </Box>
                    <Chip size="small" variant="outlined" label={`${project.deploymentTargets.length} targets`} />
                    <Typography variant="caption" color="text.secondary" sx={{ width: 116, textAlign: "right", flexShrink: 0 }}>
                      {formatUpdated(project.updatedAt)}
                    </Typography>
                  </Stack>
                </ButtonBase>
              </Box>
            ))
          )}
        </Paper>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h6" component="h2">Management API</Typography>
                <Typography variant="body2" color="text.secondary">Checks performed by the health endpoint</Typography>
              </Box>
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refreshHealth()} disabled={refreshing}>
                {refreshing ? "Checking" : "Refresh"}
              </Button>
            </Stack>
            <Stack spacing={0} sx={{ mt: 1.5 }}>
              {[
                ["API", health?.status],
                ["MongoDB", health?.mongo],
                ["Vault", health?.vault],
              ].map(([label, value]) => {
                const operational = value?.toLowerCase() === "ok";
                return (
                  <Stack key={label} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.25, borderTop: "1px solid", borderColor: "divider" }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {operational ? <CheckCircleOutlineIcon color="success" sx={{ fontSize: 19 }} /> : <CloudDoneOutlinedIcon color="disabled" sx={{ fontSize: 19 }} />}
                      <Typography variant="body2">{label}</Typography>
                    </Stack>
                    <Chip size="small" color={operational ? "success" : "default"} variant="outlined" label={healthLabel(value)} />
                  </Stack>
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              GitLab, Kubernetes, Keycloak, and SonarQube are outside this health check.
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" component="h2">Delivery coverage</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Active projects with deployment enabled
            </Typography>
            <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: 24, fontWeight: 600 }}>
                {active.length ? Math.round((summary.deployable / active.length) * 100) : 0}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.deployable} of {active.length} projects
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={active.length ? (summary.deployable / active.length) * 100 : 0}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Paper>
        </Stack>
      </Box>

      <Paper variant="outlined">
        <Box sx={{ px: 2.5, py: 2 }}>
          <Typography variant="h6" component="h2">Attention required</Typography>
          <Typography variant="body2" color="text.secondary">
            Legacy migrations and incomplete project cleanup
          </Typography>
        </Box>
        <Divider />
        {!loading && summary.attention.length === 0 ? (
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ p: 2.5 }}>
            <CheckCircleOutlineIcon color="success" />
            <Typography variant="body2">No migration or cleanup tasks are pending.</Typography>
          </Stack>
        ) : (
          summary.attention.slice(0, 5).map((project, index) => (
            <Box key={project.id}>
              {index > 0 && <Divider />}
              <ButtonBase onClick={() => onSelectProject(project)} sx={{ width: "100%", px: 2.5, py: 1.75, textAlign: "left", "&:hover": { bgcolor: "rgba(154,91,0,0.035)" } }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ width: "100%" }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{project.gitlabPath}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {project.archived ? "Cleanup did not complete; retry deletion." : "Legacy v1 project; review Auto DevOps migration."}
                    </Typography>
                  </Box>
                  <Chip size="small" color="warning" variant="outlined" label={project.archived ? "Cleanup incomplete" : "Migration available"} />
                </Stack>
              </ButtonBase>
            </Box>
          ))
        )}
      </Paper>
    </Stack>
  );
}
