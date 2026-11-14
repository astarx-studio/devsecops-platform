"use client";

import {
  Alert,
  Box,
  Button,
  Divider,
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
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { Project, Provisioning } from "@/lib/types";

interface Props {
  onCreated: (project: Project) => void;
}

export function CreateProjectForm({ onCreated }: Props) {
  const [groupPath, setGroupPath] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provisioning, setProvisioning] = useState<Provisioning>("AUTO_DEVOPS");
  const [templateSlug, setTemplateSlug] = useState("");
  const [deployable, setDeployable] = useState(true);
  const [publishable, setPublishable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slugHint, setSlugHint] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ slug: string; description?: string | null }>>([]);

  useEffect(() => {
    if (provisioning !== "TEMPLATE") return;
    void graphqlRequest<{ templates: Array<{ slug: string; description?: string | null }> }>(QUERIES.templates)
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
      void graphqlRequest<{ slugAvailable: boolean }>(QUERIES.slugAvailable, { slug })
        .then((data) => setSlugHint(data.slugAvailable ? "Slug is available" : "Slug is already taken"))
        .catch(() => setSlugHint(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [projectSlug]);

  const submit = useCallback(() => {
    const segments = groupPath.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length || !projectSlug.trim()) {
      setError("Group path and project slug are required.");
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const data = await graphqlRequest<{ createProject: Project }>(MUTATIONS.createProject, {
          input: {
            groupPath: segments,
            projectSlug: projectSlug.trim(),
            displayName: displayName.trim() || undefined,
            provisioning,
            templateSlug: provisioning === "TEMPLATE" ? templateSlug.trim() : undefined,
            capabilities: { deployable, publishable },
          },
        });
        onCreated(data.createProject);
        setProjectSlug("");
        setDisplayName("");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [groupPath, projectSlug, displayName, provisioning, templateSlug, deployable, publishable, onCreated]);

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      sx={{ overflow: "hidden" }}
    >
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Typography component="h2" variant="h6">Project configuration</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          Define where the repository lives and how DSOaaS should provision it.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2.25}>
          <TextField
            id="create-group-path"
            label="Group path"
            value={groupPath}
            onChange={(event) => setGroupPath(event.target.value)}
            helperText="Slash-separated GitLab group path. Do not include the project slug."
            placeholder="engineering / product"
            fullWidth
            required
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Project slug"
              value={projectSlug}
              onChange={(event) => setProjectSlug(event.target.value)}
              helperText={slugHint ?? "Availability is checked against the registry."}
              error={slugHint === "Slug is already taken"}
              fullWidth
              required
            />
            <TextField
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              helperText="Optional operator-friendly name."
              fullWidth
            />
          </Stack>
          <FormControl fullWidth>
            <InputLabel id="create-provisioning-label">Provisioning method</InputLabel>
            <Select
              labelId="create-provisioning-label"
              id="create-provisioning"
              label="Provisioning method"
              value={provisioning}
              onChange={(event) => setProvisioning(event.target.value as Provisioning)}
            >
              <MenuItem value="AUTO_DEVOPS">Auto DevOps</MenuItem>
              <MenuItem value="TEMPLATE">Platform template</MenuItem>
            </Select>
          </FormControl>
          {provisioning === "TEMPLATE" && (
            <FormControl fullWidth required>
              <InputLabel id="create-template-label">Template</InputLabel>
              <Select
                labelId="create-template-label"
                id="create-template"
                label="Template"
                value={templateSlug}
                onChange={(event) => setTemplateSlug(event.target.value)}
                renderValue={(value) => value}
                MenuProps={{
                  PaperProps: {
                    style: { minWidth: 0 },
                    sx: {
                      width: { xs: "calc(100vw - 32px)", sm: 560 },
                      maxWidth: "calc(100vw - 32px)",
                    },
                  },
                }}
              >
                {templates.map((template) => (
                  <MenuItem
                    key={template.slug}
                    value={template.slug}
                    sx={{ whiteSpace: "normal", alignItems: "flex-start", py: 1.25 }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={500}>{template.slug}</Typography>
                      {template.description && (
                        <Typography variant="body2" color="text.secondary">{template.description}</Typography>
                      )}
                    </Box>
                  </MenuItem>
                ))}
                {templates.length === 0 && <MenuItem value="" disabled>No templates returned</MenuItem>}
              </Select>
            </FormControl>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Typography component="h3" variant="h6">Delivery capabilities</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          Set the capabilities this project receives at creation time.
        </Typography>
        <Stack divider={<Divider />} spacing={0}>
          <FormControlLabel
            control={<Switch checked={deployable} onChange={(event) => setDeployable(event.target.checked)} />}
            label={
              <Box sx={{ py: 1.25 }}>
                <Typography variant="body2" fontWeight={500}>Deployable</Typography>
                <Typography variant="caption" color="text.secondary">Connect deployment targets, Vault configuration, and CI delivery.</Typography>
              </Box>
            }
            sx={{ mx: 0, alignItems: "center", justifyContent: "space-between" }}
            labelPlacement="start"
          />
          <FormControlLabel
            control={<Switch checked={publishable} onChange={(event) => setPublishable(event.target.checked)} />}
            label={
              <Box sx={{ py: 1.25 }}>
                <Typography variant="body2" fontWeight={500}>Publishable</Typography>
                <Typography variant="caption" color="text.secondary">Allow publishing. This capability cannot be changed after creation.</Typography>
              </Box>
            }
            sx={{ mx: 0, alignItems: "center", justifyContent: "space-between" }}
            labelPlacement="start"
          />
        </Stack>
      </Box>
      <Divider />
      <Stack direction="row" justifyContent="flex-end" sx={{ p: 2, px: { md: 3 }, bgcolor: "#f5f7f7" }}>
        <Button type="submit" variant="contained" disabled={busy || slugHint === "Slug is already taken"}>
          {busy ? "Creating project…" : "Create project"}
        </Button>
      </Stack>
    </Paper>
  );
}
