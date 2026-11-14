"use client";

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FilterListOutlinedIcon from "@mui/icons-material/FilterListOutlined";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import {
  Alert,
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { Project, ReconcileGitLabProjectsResult } from "@/lib/types";

type ListCategory = "active" | "archived";

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

function projectInitial(project: Project) {
  return (project.displayName || project.effectiveSlug).slice(0, 1).toUpperCase();
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ projects: Project[] }>(QUERIES.projects, {
        page: 0,
        perPage: 100,
        filter: {
          archived: category === "archived",
          ...(groupPrefix.trim() ? { groupPathPrefix: groupPrefix.trim() } : {}),
          ...(legacyOnly ? { legacyV1: true } : {}),
          ...(pinnedOnly ? { pinnedV1: true } : {}),
        },
      });
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
      (project) => project.id === preferredId || project.effectiveSlug === preferredSlug,
    );
    if (match) onSelect(match);
  }, [projects, preferredId, preferredSlug, selectedId, onSelect]);

  const visible = projects.filter((project) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return (
      project.gitlabPath.toLowerCase().includes(query) ||
      project.effectiveSlug.toLowerCase().includes(query) ||
      (project.displayName ?? "").toLowerCase().includes(query)
    );
  });

  const activeFilterCount = [groupPrefix.trim(), legacyOnly, pinnedOnly].filter(Boolean).length;

  return (
    <Paper variant="outlined" sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ px: 2, pt: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box>
            <Typography component="h2" variant="h6">
              Project registry
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {loading && projects.length === 0 ? "Loading registry…" : `${projects.length} ${category} ${projects.length === 1 ? "project" : "projects"}`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Detect unregistered GitLab projects">
              <span>
                <IconButton
                  size="small"
                  onClick={() => void detectFromGitLab()}
                  disabled={loading || detecting}
                  aria-label="Detect projects from GitLab"
                >
                  <ManageSearchIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Refresh project registry">
              <span>
                <IconButton size="small" onClick={() => void load()} disabled={loading || detecting} aria-label="Refresh projects">
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        <TextField
          id="project-search"
          size="small"
          placeholder="Search name, path, or slug"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          fullWidth
          slotProps={{
            htmlInput: { "aria-label": "Search projects" },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon sx={{ fontSize: 19 }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ my: 0.75 }}>
          <Chip
            icon={<FilterListOutlinedIcon />}
            label={activeFilterCount ? `Filters · ${activeFilterCount}` : "Filters"}
            variant={activeFilterCount ? "filled" : "outlined"}
            color={activeFilterCount ? "primary" : "default"}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="project-advanced-filters"
            deleteIcon={<ExpandMoreIcon sx={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease-out" }} />}
            onDelete={() => setFiltersOpen((open) => !open)}
            sx={{ height: 32, "& .MuiChip-label": { px: 0.75 } }}
          />
          {(loading || detecting) && <CircularProgress size={17} aria-label={detecting ? "Detecting projects" : "Loading projects"} />}
        </Stack>

        <Collapse in={filtersOpen} id="project-advanced-filters">
          <Stack spacing={1} sx={{ pb: 1.5 }}>
            <TextField
              id="project-group-prefix"
              size="small"
              label="Group path prefix"
              placeholder="e.g. platform/"
              value={groupPrefix}
              onChange={(event) => setGroupPrefix(event.target.value)}
              fullWidth
            />
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap role="group" aria-label="Project filters">
              <Chip
                label="Legacy only"
                size="small"
                color={legacyOnly ? "primary" : "default"}
                variant={legacyOnly ? "filled" : "outlined"}
                aria-pressed={legacyOnly}
                onClick={() => setLegacyOnly((value) => !value)}
              />
              <Chip
                label="Pinned only"
                size="small"
                color={pinnedOnly ? "primary" : "default"}
                variant={pinnedOnly ? "filled" : "outlined"}
                aria-pressed={pinnedOnly}
                onClick={() => setPinnedOnly((value) => !value)}
              />
            </Stack>
          </Stack>
        </Collapse>
      </Box>

      <Tabs
        value={category}
        onChange={(_, value: ListCategory) => onCategoryChange(value)}
        variant="fullWidth"
        aria-label="Project status"
        selectionFollowsFocus
        sx={{ borderTop: 1, borderBottom: 1, borderColor: "divider", minHeight: 44 }}
      >
        <Tab id="list-tab-active" aria-controls="project-list" label="Active" value="active" />
        <Tab id="list-tab-archived" aria-controls="project-list" label="Archived" value="archived" />
      </Tabs>

      {detectMessage && (
        <Alert severity="info" sx={{ m: 1.5, mb: 0 }} onClose={() => setDetectMessage(null)}>
          {detectMessage}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ m: 1.5, mb: 0 }}>{error}</Alert>}

      <List
        id="project-list"
        aria-label={category === "archived" ? "Archived projects" : "Active projects"}
        aria-labelledby={category === "archived" ? "list-tab-archived" : "list-tab-active"}
        disablePadding
        sx={{ overflow: "auto", flex: 1, minHeight: 0 }}
      >
        {visible.map((project) => {
          const selected = project.id === selectedId;
          return (
            <Box key={project.id}>
              <ListItemButton
                selected={selected}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(project)}
                alignItems="flex-start"
                sx={{
                  px: 2,
                  py: 1.5,
                  gap: 1.25,
                  bgcolor: selected ? "primary.light" : "transparent",
                  "&.Mui-selected": { bgcolor: "primary.light" },
                  "&.Mui-selected:hover": { bgcolor: "#dcece8" },
                  "&:hover": { bgcolor: selected ? "#dcece8" : "rgba(15,107,99,0.035)" },
                }}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    mt: 0.25,
                    fontSize: 14,
                    fontWeight: 600,
                    bgcolor: selected ? "primary.main" : "#e3eaec",
                    color: selected ? "primary.contrastText" : "text.secondary",
                  }}
                >
                  {projectInitial(project)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
                      {project.displayName || project.effectiveSlug}
                    </Typography>
                    {project.legacyV1 && <Chip label="Legacy" size="small" color="warning" variant="outlined" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ mt: 0.2 }}>
                    {project.gitlabPath}
                  </Typography>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                      {project.effectiveSlug}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">·</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {project.deploymentTargets.length} {project.deploymentTargets.length === 1 ? "target" : "targets"}
                    </Typography>
                    {project.pinnedV1 && <Chip label="Pinned" size="small" variant="outlined" />}
                  </Stack>
                </Box>
              </ListItemButton>
              <Divider />
            </Box>
          );
        })}
        {!loading && visible.length === 0 && (
          <Stack spacing={1} alignItems="center" sx={{ p: 4, textAlign: "center" }} role="status">
            <SearchOutlinedIcon sx={{ color: "text.disabled", fontSize: 32 }} />
            <Typography variant="body2" fontWeight={500}>
              {projects.length ? "No projects match your search" : category === "archived" ? "No archived projects" : "No active projects"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {projects.length ? "Try a different name, path, or slug." : category === "archived" ? "Projects with incomplete cleanup will appear here." : "Create or register a project to populate the registry."}
            </Typography>
          </Stack>
        )}
      </List>
      {visible.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, borderTop: 1, borderColor: "divider" }}>
          Showing {visible.length} of {projects.length}
        </Typography>
      )}
    </Paper>
  );
}

export type { ListCategory };
