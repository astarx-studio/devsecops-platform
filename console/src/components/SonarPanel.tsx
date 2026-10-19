"use client";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Link,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { Project, SonarBranchProvision, SonarGateMode } from "@/lib/types";

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

function parseBranches(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((b) => b.trim())
        .filter(Boolean),
    ),
  ];
}

export function SonarPanel({ project, onUpdated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branchInput, setBranchInput] = useState("");
  const [addToAllowedBranches, setAddToAllowedBranches] = useState(true);
  const [allowedBranchesInput, setAllowedBranchesInput] = useState("");
  const [sonarToken, setSonarToken] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [gate, setGate] = useState({
    dev: "optional" as SonarGateMode,
    stg: "required" as SonarGateMode,
    prod: "required" as SonarGateMode,
    other: "optional" as SonarGateMode,
  });
  const [provisionResults, setProvisionResults] = useState<
    SonarBranchProvision[] | null
  >(null);

  const deployBranchHints = useMemo(() => {
    const refs = project.deploymentTargets
      .map((t) => t.deployRef)
      .filter((r) => r && r !== "none");
    return [...new Set(refs)];
  }, [project.deploymentTargets]);

  useEffect(() => {
    const branches = project.sonar?.allowedBranches ?? [];
    setBranchInput(branches.join(", "));
    setProvisionResults(null);
  }, [project.id]);

  useEffect(() => {
    setAllowedBranchesInput((project.sonar?.allowedBranches ?? []).join(", "));
    const policy = project.sonar?.gatePolicy;
    const mode = (
      value: string | null | undefined,
      fallback: SonarGateMode,
    ): SonarGateMode =>
      value?.toLowerCase() === "required"
        ? "required"
        : value?.toLowerCase() === "optional"
          ? "optional"
          : fallback;
    setGate({
      dev: mode(policy?.dev, "optional"),
      stg: mode(policy?.stg, "required"),
      prod: mode(policy?.prod, "required"),
      other: mode(policy?.other, "optional"),
    });
  }, [project.sonar?.allowedBranches, project.sonar?.gatePolicy]);

  const runMutation = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError((err as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const provision = useCallback(() => {
    const branches = parseBranches(branchInput);
    if (!branches.length) {
      setError("Enter at least one branch name to provision in SonarQube.");
      return;
    }
    void runMutation(async () => {
      const data = await graphqlRequest<{
        provisionSonarProjects: SonarBranchProvision[];
      }>(MUTATIONS.provisionSonarProjects, {
        id: project.id,
        branches,
        addToAllowedBranches,
      });
      setProvisionResults(data.provisionSonarProjects);
      if (addToAllowedBranches) {
        const refreshed = await graphqlRequest<{ project: Project }>(
          QUERIES.project,
          {
            id: project.id,
          },
        );
        onUpdated(refreshed.project);
      }
    });
  }, [addToAllowedBranches, branchInput, onUpdated, project.id, runMutation]);

  const saveSonarConfig = useCallback(() => {
    const allowedBranches = parseBranches(allowedBranchesInput);
    void runMutation(async () => {
      const wire = (mode: SonarGateMode) =>
        mode === "required" ? "REQUIRED" : "OPTIONAL";
      const input: {
        allowedBranches: string[];
        sonarToken?: string;
        gatePolicy: { dev: string; stg: string; prod: string; other: string };
      } = {
        allowedBranches,
        gatePolicy: {
          dev: wire(gate.dev),
          stg: wire(gate.stg),
          prod: wire(gate.prod),
          other: wire(gate.other),
        },
      };
      if (sonarToken.trim()) {
        input.sonarToken = sonarToken.trim();
      }
      const data = await graphqlRequest<{ updateProjectSonarConfig: Project }>(
        MUTATIONS.updateProjectSonarConfig,
        { id: project.id, input },
      );
      setSonarToken("");
      onUpdated(data.updateProjectSonarConfig);
    });
  }, [
    allowedBranchesInput,
    gate,
    onUpdated,
    project.id,
    runMutation,
    sonarToken,
  ]);

  const deleteSonar = useCallback(() => {
    const branches = parseBranches(branchInput);
    if (!branches.length) {
      setError("Enter branch names to delete from SonarQube.");
      return;
    }
    setDeleteOpen(true);
  }, [branchInput]);

  return (
    <Box>
      <Typography
        component="h3"
        variant="subtitle1"
        fontWeight={600}
        gutterBottom
      >
        SonarQube
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Provision creates Sonar projects per branch and syncs GitLab CI
        variables. When the API has Sonar admin credentials, a global analysis
        token is generated (or reused from Vault) and set as{" "}
        <code>SONAR_TOKEN</code>.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {project.sonar && project.sonar.allowedBranches.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 2 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ alignSelf: "center" }}
          >
            Allowed branches:
          </Typography>
          {project.sonar.allowedBranches.map((b) => (
            <Chip key={b} label={b} size="small" />
          ))}
          {project.sonar.dashboardUrl && (
            <Link
              href={project.sonar.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Sonar dashboard (opens in a new tab)"
            >
              Sonar dashboard
              <OpenInNewIcon
                aria-hidden
                sx={{ fontSize: 14, ml: 0.5, verticalAlign: "middle" }}
              />
            </Link>
          )}
        </Stack>
      )}

      <Stack spacing={2}>
        <TextField
          label="Branches to provision"
          size="small"
          fullWidth
          value={branchInput}
          onChange={(e) => setBranchInput(e.target.value)}
          placeholder="main, staging, develop"
          helperText={
            deployBranchHints.length > 0
              ? `Deploy refs: ${deployBranchHints.join(", ")}`
              : "Comma-separated Git branch names"
          }
          disabled={busy}
        />

        <FormControlLabel
          control={
            <Switch
              checked={addToAllowedBranches}
              onChange={(e) => setAddToAllowedBranches(e.target.checked)}
              disabled={busy}
            />
          }
          label="Merge branches into SONAR_ALLOWED_BRANCHES (GitLab CI)"
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" onClick={provision} disabled={busy}>
            Provision Sonar projects
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={deleteSonar}
            disabled={busy}
          >
            Delete Sonar projects
          </Button>
        </Stack>

        {provisionResults && provisionResults.length > 0 && (
          <Table size="small" aria-label="SonarQube projects by branch">
            <TableHead>
              <TableRow>
                <TableCell>Branch</TableCell>
                <TableCell>Project key</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Dashboard</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {provisionResults.map((row) => (
                <TableRow key={row.projectKey}>
                  <TableCell>{row.branch}</TableCell>
                  <TableCell>
                    <code>{row.projectKey}</code>
                  </TableCell>
                  <TableCell>
                    {row.created ? "Created" : "Already existed"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={row.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${row.branch} dashboard (opens in a new tab)`}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Typography component="h4" variant="subtitle2" sx={{ pt: 1 }}>
          CI variables & token
        </Typography>
        <TextField
          label="SONAR_ALLOWED_BRANCHES"
          size="small"
          fullWidth
          value={allowedBranchesInput}
          onChange={(e) => setAllowedBranchesInput(e.target.value)}
          placeholder="main, staging, develop"
          disabled={busy}
        />
        <TextField
          label="SONAR_TOKEN (optional)"
          size="small"
          fullWidth
          type="password"
          value={sonarToken}
          onChange={(e) => setSonarToken(e.target.value)}
          helperText="Stored in Vault and mirrored to GitLab when provided. Leave empty to keep existing."
          disabled={busy}
        />
        <Stack direction="row" spacing={1}>
          {(["dev", "stg", "prod", "other"] as const).map((tier) => (
            <FormControl key={tier} size="small" sx={{ minWidth: 120 }}>
              <InputLabel id={`sonar-gate-${tier}-label`}>
                {tier} gate
              </InputLabel>
              <Select
                labelId={`sonar-gate-${tier}-label`}
                id={`sonar-gate-${tier}`}
                label={`${tier} gate`}
                value={gate[tier]}
                onChange={(e) =>
                  setGate((prev) => ({
                    ...prev,
                    [tier]: e.target.value as SonarGateMode,
                  }))
                }
                disabled={busy}
              >
                <MenuItem value="optional">optional</MenuItem>
                <MenuItem value="required">required</MenuItem>
              </Select>
            </FormControl>
          ))}
        </Stack>
        <Button variant="outlined" onClick={saveSonarConfig} disabled={busy}>
          Sync Sonar CI config
        </Button>
      </Stack>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Sonar projects"
        message={`Delete Sonar analysis for ${parseBranches(branchInput).join(", ")} and remove those branches from the allowlist and GitLab CI. If the allowlist becomes empty, SONAR_TOKEN is removed from GitLab CI. The Vault copy of the token is kept.`}
        confirmLabel="Delete"
        typedMatch={project.effectiveSlug}
        busy={busy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          const branches = parseBranches(branchInput);
          setDeleteOpen(false);
          void runMutation(async () => {
            await graphqlRequest(MUTATIONS.deleteSonarProjects, {
              id: project.id,
              branches,
              pruneAllowlist: true,
            });
            const refreshed = await graphqlRequest<{ project: Project }>(
              QUERIES.project,
              {
                id: project.id,
              },
            );
            setProvisionResults(null);
            onUpdated(refreshed.project);
          });
        }}
      />
    </Box>
  );
}
