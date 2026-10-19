"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import { QUERIES } from "@/lib/graphql";
import type { DeploymentTarget, Project } from "@/lib/types";

interface LogChunk {
  pod: string;
  container: string;
  phase?: string | null;
  text: string;
  truncated: boolean;
  error?: string | null;
}

interface AppContainerLogs {
  clusterProfile: string;
  namespace: string;
  releaseName: string;
  tailLines: number;
  previous: boolean;
  message?: string | null;
  chunks: LogChunk[];
}

const TAIL_CHOICES = [100, 200, 500] as const;
const FOLLOW_MS = 2000;

function appChoices(
  project: Project,
  target: DeploymentTarget | undefined,
): string[] {
  const names = (target?.apps ?? []).map((app) => app.name).filter(Boolean);
  return names.length > 0 ? names : [project.effectiveSlug];
}

function LogTail({ label, text }: { label: string; text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <Box
      component="pre"
      ref={ref}
      aria-label={label}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 360,
        overflow: "auto",
        bgcolor: "grey.900",
        color: "grey.100",
        borderRadius: 1,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </Box>
  );
}

export function AppContainerLogPanel({ project }: { project?: Project }) {
  const locked = Boolean(project);
  const [projects, setProjects] = useState<Project[]>(project ? [project] : []);
  const [projectId, setProjectId] = useState(project?.id ?? "");
  const [targetKey, setTargetKey] = useState(
    project?.deploymentTargets[0]?.key ?? "",
  );
  const [appName, setAppName] = useState(
    project ? (appChoices(project, project.deploymentTargets[0])[0] ?? "") : "",
  );
  const [tailLines, setTailLines] = useState<number>(100);
  const [previous, setPrevious] = useState(false);
  const [follow, setFollow] = useState(true);
  const [container, setContainer] = useState("");
  const [logs, setLogs] = useState<AppContainerLogs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(!locked);
  const [listError, setListError] = useState<string | null>(null);
  const containerRef = useRef(container);
  containerRef.current = container;
  const requestSeq = useRef(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await graphqlRequest<{ projects: Project[] }>(
          QUERIES.projects,
          {
            page: 0,
            perPage: 100,
          },
        );
        if (cancelled) return;
        const items = data.projects;
        setProjects(items);
        setProjectId((current) => current || items[0]?.id || "");
      } catch (err) {
        if (!cancelled) {
          setListError(
            err instanceof Error ? err.message : "Could not load projects",
          );
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locked]);

  const selected = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projects, projectId],
  );
  const targets = selected?.deploymentTargets ?? [];
  const target = targets.find((item) => item.key === targetKey) ?? targets[0];
  const apps = selected && target ? appChoices(selected, target) : [];
  const resolvedApp = apps.includes(appName) ? appName : (apps[0] ?? "");

  const load = useCallback(
    async (mode: "open" | "follow" | "refresh" = "open") => {
      if (!projectId || !target?.key || !resolvedApp) return;
      const silent = mode === "follow";
      const seq = ++requestSeq.current;
      if (!silent) {
        loadingRef.current = true;
        setLoading(true);
        setError(null);
      }
      try {
        const data = await graphqlRequest<{
          appContainerLogs: AppContainerLogs;
        }>(QUERIES.appContainerLogs, {
          id: projectId,
          targetKey: target.key,
          appName: resolvedApp,
          tailLines: Math.max(100, tailLines),
          previous,
          container: containerRef.current.trim() || null,
          follow: silent,
        });
        if (seq !== requestSeq.current) return;
        setLogs(data.appContainerLogs);
        if (silent) setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const message =
          err instanceof Error ? err.message : "Could not load container logs";
        if (!silent) setLogs(null);
        setError(message);
      } finally {
        if (seq === requestSeq.current && !silent) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [projectId, target?.key, resolvedApp, tailLines, previous],
  );

  useEffect(() => {
    void load("open");
  }, [load]);

  useEffect(() => {
    if (!follow || previous || !projectId || !target?.key || !resolvedApp) {
      return;
    }
    const timer = window.setInterval(() => {
      if (loadingRef.current) return;
      void load("follow");
    }, FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [follow, previous, load, projectId, target?.key, resolvedApp]);

  function chooseProject(id: string) {
    const next = projects.find((item) => item.id === id);
    const nextTarget = next?.deploymentTargets[0];
    setProjectId(id);
    setTargetKey(nextTarget?.key ?? "");
    setAppName(
      next && nextTarget ? (appChoices(next, nextTarget)[0] ?? "") : "",
    );
  }

  function chooseTarget(key: string) {
    const nextTarget = targets.find((item) => item.key === key);
    setTargetKey(key);
    setAppName(
      selected && nextTarget ? (appChoices(selected, nextTarget)[0] ?? "") : "",
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        At least 100 lines from the pods of one app. Follow keeps the latest
        lines in view. The namespace comes from the deployment target. Output
        can include anything the process printed.
      </Typography>
      {listError && <Alert severity="error">{listError}</Alert>}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        useFlexGap
        flexWrap="wrap"
      >
        {!locked && (
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="app-log-project-label">Project</InputLabel>
            <Select
              labelId="app-log-project-label"
              label="Project"
              value={projectId}
              onChange={(event) => chooseProject(event.target.value)}
            >
              {projects.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.gitlabPath}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl size="small" sx={{ minWidth: 140 }} disabled={!selected}>
          <InputLabel id="app-log-target-label">Target</InputLabel>
          <Select
            labelId="app-log-target-label"
            label="Target"
            value={target?.key ?? ""}
            onChange={(event) => chooseTarget(event.target.value)}
          >
            {targets.map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.key}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }} disabled={!selected}>
          <InputLabel id="app-log-app-label">App</InputLabel>
          <Select
            labelId="app-log-app-label"
            label="App"
            value={resolvedApp}
            onChange={(event) => setAppName(event.target.value)}
          >
            {apps.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="app-log-tail-label">Lines</InputLabel>
          <Select
            labelId="app-log-tail-label"
            label="Lines"
            value={String(tailLines)}
            onChange={(event) => setTailLines(Number(event.target.value))}
          >
            {TAIL_CHOICES.map((count) => (
              <MenuItem key={count} value={String(count)}>
                {count}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Container"
          value={container}
          onChange={(event) => setContainer(event.target.value)}
          helperText="Optional. Blank reads every container."
          sx={{ minWidth: 200 }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
              inputProps={{ "aria-label": "Follow new log lines" }}
            />
          }
          label="Follow"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={previous}
              onChange={(event) => setPrevious(event.target.checked)}
              inputProps={{ "aria-label": "Previous container instance" }}
            />
          }
          label="Previous instance"
        />
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => void load("refresh")}
          disabled={loading || !projectId || !target?.key}
        >
          Refresh
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {(listLoading || (loading && !logs)) && (
        <Typography variant="body2" role="status">
          {listLoading ? "Loading projects…" : "Loading container logs…"}
        </Typography>
      )}
      {follow && !previous && logs && !error && (
        <Typography variant="body2" color="text.secondary" role="status">
          Following
        </Typography>
      )}
      {!listLoading && !loading && !error && !selected && (
        <Typography variant="body2" color="text.secondary" role="status">
          No projects to read logs from.
        </Typography>
      )}
      {!loading && !error && selected && !target && (
        <Typography variant="body2" color="text.secondary" role="status">
          This project has no deployment targets.
        </Typography>
      )}
      {!loading && logs?.message && (
        <Typography variant="body2" color="text.secondary" role="status">
          {logs.message}
        </Typography>
      )}
      {logs && (
        <Typography variant="caption" color="text.secondary">
          {logs.clusterProfile} · {logs.namespace} · {logs.releaseName}
          {logs.previous ? " · previous" : ""}
        </Typography>
      )}
      <Stack spacing={1.5}>
        {(logs?.chunks ?? []).map((chunk) => (
          <Box key={`${chunk.pod}-${chunk.container}`}>
            <Typography variant="subtitle2" component="h3">
              {chunk.pod} / {chunk.container}
              {chunk.phase ? ` · ${chunk.phase}` : ""}
              {chunk.truncated ? " · truncated" : ""}
            </Typography>
            {chunk.error && (
              <Typography variant="body2" color="error" role="alert">
                {chunk.error}
              </Typography>
            )}
            <LogTail
              label={`Logs for ${chunk.pod} ${chunk.container}`}
              text={chunk.text || (chunk.error ? "" : "(empty)")}
            />
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
