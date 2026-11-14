"use client";

import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import { MUTATIONS } from "@/lib/graphql";
import type { Project } from "@/lib/types";
import {
  buildBranchOptionsInput,
  DeployBranchFields,
  emptyDeployBranchForm,
} from "./DeployBranchFields";

interface Props {
  onRegistered: (project: Project) => void;
}

export function RegisterProjectForm({ onRegistered }: Props) {
  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [deployable, setDeployable] = useState(true);
  const [branchForm, setBranchForm] = useState(emptyDeployBranchForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    const id = Number.parseInt(gitlabProjectId, 10);
    if (!Number.isFinite(id)) {
      setError("GitLab project ID must be a number.");
      return;
    }
    setBusy(true);
    setError(null);
    const branchOptions = buildBranchOptionsInput(branchForm);
    void (async () => {
      try {
        const data = await graphqlRequest<{ registerGitLabProject: Project }>(MUTATIONS.registerGitLabProject, {
          input: {
            gitlabProjectId: id,
            capabilities: { deployable, publishable: false },
            ...(branchOptions ? { branchOptions } : {}),
          },
        });
        onRegistered(data.registerGitLabProject);
        setGitlabProjectId("");
        setBranchForm(emptyDeployBranchForm());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [gitlabProjectId, deployable, branchForm, onRegistered]);

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
        <Typography component="h2" variant="h6">GitLab connection</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          Identify the repository and choose whether to connect its delivery workflow.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="GitLab project ID"
          value={gitlabProjectId}
          onChange={(event) => setGitlabProjectId(event.target.value)}
          helperText="The numeric ID shown on the GitLab project overview page."
          type="number"
          fullWidth
          required
        />
        <FormControlLabel
          control={<Switch checked={deployable} onChange={(event) => setDeployable(event.target.checked)} />}
          label={
            <Box sx={{ py: 1.25 }}>
              <Typography variant="body2" fontWeight={500}>Connect deployment workflow</Typography>
              <Typography variant="caption" color="text.secondary">Wire Vault, CI configuration, and deployment targets.</Typography>
            </Box>
          }
          sx={{ mx: 0, mt: 2, alignItems: "center", justifyContent: "space-between" }}
          labelPlacement="start"
        />
      </Box>
      {deployable && (
        <>
          <Divider />
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Typography component="h3" variant="h6" sx={{ mb: 2 }}>Branch options</Typography>
            <DeployBranchFields showPerEnv state={branchForm} onChange={setBranchForm} disabled={busy} />
          </Box>
        </>
      )}
      <Divider />
      <Stack direction="row" justifyContent="flex-end" sx={{ p: 2, px: { md: 3 }, bgcolor: "#f5f7f7" }}>
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? "Registering project…" : "Register project"}
        </Button>
      </Stack>
    </Paper>
  );
}
