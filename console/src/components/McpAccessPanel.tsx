"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import { graphqlRequest } from "@/lib/client";
import { MUTATIONS, QUERIES } from "@/lib/graphql";
import type { McpAccessKey, McpAccessScope } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";

const SCOPE_OPTIONS: Array<{
  value: McpAccessScope;
  label: string;
  detail: string;
}> = [
  {
    value: "read",
    label: "Read",
    detail:
      "Project metadata, templates, shared CI configs, health, and audit. No secret values.",
  },
  {
    value: "read_secret",
    label: "Read secrets",
    detail: "Read, plus env profile values from Vault.",
  },
  {
    value: "operate",
    label: "Limited read/write",
    detail:
      "Read secrets, plus create and update projects, targets, env, Sonar, templates, and CI configs. No delete or teardown.",
  },
  {
    value: "full",
    label: "Full access",
    detail:
      "Every DSOaaS project, template, and config operation, including delete and teardown. Cannot issue MCP keys.",
  },
];

function scopeLabel(scope: string | null | undefined): string {
  return (
    SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? "Read"
  );
}

function cursorConnection(endpoint: string, token: string | null): string {
  const bearer = token ? `Bearer ${token}` : "Bearer dsoas_…";
  return JSON.stringify(
    {
      mcpServers: {
        dsoaas: {
          url: endpoint,
          headers: { Authorization: bearer },
        },
      },
    },
    null,
    2,
  );
}

export function McpAccessPanel() {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [keys, setKeys] = useState<McpAccessKey[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<McpAccessScope>("read");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await graphqlRequest<{ mcpAccessKeys: McpAccessKey[] }>(
      QUERIES.mcpAccessKeys,
      {
        includeRevoked,
      },
    );
    setKeys(data.mcpAccessKeys);
  }, [includeRevoked]);

  useEffect(() => {
    void fetch("/api/platform-links")
      .then((res) => res.json())
      .then((body: { mcpEndpoint?: string | null }) =>
        setEndpoint(body.mcpEndpoint ?? null),
      )
      .catch(() => setEndpoint(null));
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not load MCP keys"),
    );
  }, [load]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) {
        setError("Could not copy to the clipboard.");
        return;
      }
    }
    setCopied(label);
    setError(null);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ createMcpAccessKey: McpAccessKey }>(
        MUTATIONS.createMcpAccessKey,
        { name, scope },
      );
      setFreshToken(data.createMcpAccessKey.token ?? null);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokeId) return;
    setBusy(true);
    setError(null);
    try {
      await graphqlRequest(MUTATIONS.revokeMcpAccessKey, { id: revokeId });
      setRevokeId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the key");
    } finally {
      setBusy(false);
    }
  };

  const revokeTarget = keys.find((key) => key.id === revokeId);

  return (
    <Paper sx={{ p: 2, maxWidth: 880 }}>
      <Stack spacing={2}>
        <Typography component="h2" variant="subtitle1" fontWeight={600}>
          MCP access
        </Typography>
        <Typography variant="body2" color="text.secondary">
          IDE clients call the MCP endpoint with a key issued here. Each key has
          one access level. The token is shown once. Higher levels include the
          tools of the levels below them.
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "center" }}
        >
          <TextField
            id="mcp-endpoint"
            label="MCP endpoint"
            value={endpoint ?? "Set DSOAAS_MCP_PUBLIC_URL"}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { readOnly: true } }}
          />
          <Tooltip title={copied === "endpoint" ? "Copied" : "Copy endpoint"}>
            <span>
              <IconButton
                aria-label="Copy MCP endpoint"
                disabled={!endpoint}
                onClick={() => endpoint && void copy("endpoint", endpoint)}
              >
                <ContentCopyIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            disabled={!endpoint}
            aria-label="Copy Cursor connection"
            onClick={() =>
              endpoint &&
              void copy("cursor", cursorConnection(endpoint, freshToken))
            }
          >
            {copied === "cursor" ? "Copied" : "Copy Cursor config"}
          </Button>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {freshToken
            ? "Copy Cursor config includes this endpoint and the new access key."
            : "Copy Cursor config pastes an mcpServers block. Create a key first if you want the bearer token filled in."}
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        {freshToken && (
          <Alert severity="warning" onClose={() => setFreshToken(null)}>
            <Stack spacing={1}>
              <span>Copy this access key now. It will not be shown again.</span>
              <TextField
                id="mcp-fresh-token"
                label="New access key"
                value={freshToken}
                fullWidth
                size="small"
                slotProps={{ htmlInput: { readOnly: true } }}
              />
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<ContentCopyIcon />}
                  aria-label="Copy Cursor connection with this key"
                  onClick={() =>
                    endpoint &&
                    void copy("cursor", cursorConnection(endpoint, freshToken))
                  }
                  disabled={!endpoint}
                >
                  {copied === "cursor" ? "Copied" : "Copy Cursor config"}
                </Button>
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => void copy("token", freshToken)}
                >
                  {copied === "token" ? "Copied" : "Copy access key"}
                </Button>
              </Box>
            </Stack>
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ sm: "flex-start" }}
        >
          <TextField
            id="mcp-key-name"
            label="Key name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            helperText="A label for this client, such as Cursor laptop."
            fullWidth
            size="small"
          />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="mcp-key-scope-label">Access</InputLabel>
            <Select
              labelId="mcp-key-scope-label"
              id="mcp-key-scope"
              label="Access"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as McpAccessScope)
              }
            >
              {SCOPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            disabled={busy || name.trim().length === 0}
            onClick={() => void create()}
          >
            Create key
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {SCOPE_OPTIONS.find((option) => option.value === scope)?.detail}
        </Typography>

        <FormControlLabel
          control={
            <Checkbox
              checked={includeRevoked}
              onChange={(event) => setIncludeRevoked(event.target.checked)}
            />
          }
          label="Show revoked keys"
        />

        <Table size="small" aria-label="MCP access keys">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Access</TableCell>
              <TableCell>Prefix</TableCell>
              <TableCell>Last used</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {keys.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography
                    role="status"
                    variant="body2"
                    color="text.secondary"
                  >
                    No MCP keys yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.name}</TableCell>
                <TableCell>{scopeLabel(key.scope)}</TableCell>
                <TableCell>
                  <code>{key.tokenPrefix}</code>
                </TableCell>
                <TableCell>
                  {key.lastUsedAt
                    ? new Date(key.lastUsedAt).toLocaleString()
                    : "Never"}
                </TableCell>
                <TableCell>{key.revokedAt ? "Revoked" : "Active"}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="error"
                    disabled={busy || Boolean(key.revokedAt)}
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => setRevokeId(key.id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>

      <ConfirmDialog
        open={Boolean(revokeId)}
        title="Revoke MCP key"
        message={
          revokeTarget
            ? `Clients using ${revokeTarget.name} (${revokeTarget.tokenPrefix}…) will be rejected.`
            : "This key will stop working."
        }
        confirmLabel="Revoke key"
        busy={busy}
        onClose={() => setRevokeId(null)}
        onConfirm={() => void revoke()}
      />
    </Paper>
  );
}
