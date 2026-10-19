'use client';
import ManageSearchIcon from '@mui/icons-material/ManageSearch';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
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
  preferredId?: string | null;
  preferredSlug?: string | null;
}

export function ProjectList({
  selectedId,
  onSelect,
  refreshToken,
  category,
  onCategoryChange,
  onDetected,
  preferredId,
  preferredSlug,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [search, setSearch] = useState("");
  const [groupPrefix, setGroupPrefix] = useState("");
  const [legacyOnly, setLegacyOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ projects: Project[] }>(
        QUERIES.projects,
        {
          page: 0,
          perPage: 100,
          filter: {
            archived: category === "archived",
            ...(groupPrefix.trim()
              ? { groupPathPrefix: groupPrefix.trim() }
              : {}),
            ...(legacyOnly ? { legacyV1: true } : {}),
            ...(pinnedOnly ? { pinnedV1: true } : {}),
          },
        },
      );
      setProjects(data.projects);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [category, groupPrefix, legacyOnly, pinnedOnly]);

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

  useEffect(() => {
    if (selectedId || (!preferredId && !preferredSlug)) return;
    const match = projects.find(
      (p) => p.id === preferredId || p.effectiveSlug === preferredSlug,
    );
    if (match) onSelect(match);
  }, [projects, preferredId, preferredSlug, selectedId, onSelect]);

  const visible = projects.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.gitlabPath.toLowerCase().includes(q) ||
      p.effectiveSlug.toLowerCase().includes(q) ||
      (p.displayName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Paper sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack sx={{ px: 1.5, pt: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography component="h2" variant="subtitle1" fontWeight={600}>
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
        <TextField
          id="project-search"
          size="small"
          label="Search projects"
          placeholder="Path or slug"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          sx={{ my: 1 }}
        />
        <TextField
          id="project-group-prefix"
          size="small"
          label="Group path prefix"
          placeholder="e.g. platform/"
          value={groupPrefix}
          onChange={(e) => setGroupPrefix(e.target.value)}
          fullWidth
          sx={{ mb: 1 }}
        />
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ mb: 1 }}
          role="group"
          aria-label="Project filters"
        >
          <Chip
            label={legacyOnly ? "Legacy only, on" : "Legacy only"}
            size="small"
            color={legacyOnly ? "warning" : "default"}
            variant={legacyOnly ? "filled" : "outlined"}
            aria-pressed={legacyOnly}
            onClick={() => setLegacyOnly((v) => !v)}
          />
          <Chip
            label={pinnedOnly ? "Pinned only, on" : "Pinned only"}
            size="small"
            color={pinnedOnly ? "warning" : "default"}
            variant={pinnedOnly ? "filled" : "outlined"}
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((v) => !v)}
          />
          {loading && (
            <CircularProgress size={16} aria-label="Loading projects" />
          )}
        </Stack>
        <Tabs
          value={category}
          onChange={(_, v: ListCategory) => onCategoryChange(v)}
          variant="fullWidth"
          aria-label="Project status"
          selectionFollowsFocus
        >
          <Tab
            id="list-tab-active"
            aria-controls="project-list"
            label="Active"
            value="active"
          />
          <Tab
            id="list-tab-archived"
            aria-controls="project-list"
            label="Archived"
            value="archived"
          />
        </Tabs>
      </Stack>
      {detectMessage && (
        <Alert
          severity="info"
          sx={{ mx: 1.5, mb: 1 }}
          onClose={() => setDetectMessage(null)}
        >
          {detectMessage}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mx: 1.5, mb: 1 }}>
          {error}
        </Alert>
      )}
      <List
        id="project-list"
        aria-label={
          category === "archived" ? "Archived projects" : "Active projects"
        }
        aria-labelledby={
          category === "archived" ? "list-tab-archived" : "list-tab-active"
        }
        dense
        sx={{ overflow: "auto", flex: 1 }}
      >
        {visible.map((p) => (
          <ListItemButton
            key={p.id}
            selected={p.id === selectedId}
            aria-current={p.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(p)}
            sx={
              p.id === selectedId
                ? { borderLeft: 4, borderColor: "primary.main", pl: 1.5 }
                : undefined
            }
          >
            <ListItemText
              primary={p.gitlabPath}
              secondary={
                <Stack
                  direction="row"
                  spacing={0.5}
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mt: 0.5 }}
                >
                  <Chip
                    label={p.effectiveSlug}
                    size="small"
                    variant="outlined"
                  />
                  {p.archived && (
                    <Chip
                      label="archived"
                      size="small"
                      color="default"
                      variant="filled"
                    />
                  )}
                  {p.capabilities.deployable && (
                    <Chip
                      label="deploy"
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                  {p.legacyV1 && (
                    <Chip
                      label="legacy"
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  )}
                  {p.pinnedV1 && (
                    <Chip
                      label="pinned"
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  )}
                </Stack>
              }
              slotProps={{
                primary: { noWrap: true },
                // Chips/Stack render as divs; default secondary Typography is inline (span).
                secondary: { component: "div" },
              }}
            />
          </ListItemButton>
        ))}
        {!loading && visible.length === 0 && (
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ p: 2 }}
          >
            {category === "archived"
              ? "No archived (dangling) projects."
              : "No active projects in registry."}
          </Typography>
        )}
      </List>
    </Paper>
  );
}

export type { ListCategory };
