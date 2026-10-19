"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  auditEventLabel,
  formatAuditMetadata,
  formatAuditWhen,
  type AuditLogRow,
} from "@/lib/audit";
import { graphqlRequest } from "@/lib/client";
import { QUERIES } from "@/lib/graphql";

export function AuditLogPanel() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ auditLogs: AuditLogRow[] }>(
        QUERIES.auditLogs,
        { limit: 100 },
      );
      setRows(data.auditLogs);
    } catch (err) {
      setRows([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.eventType,
        row.actor,
        row.gitlabPath,
        row.effectiveSlug,
        formatAuditMetadata(row.metadata),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search]);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" component="h2">
          Logs
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Recent platform audit events, newest first. Secret values are not
          stored. MCP key events appear here even when they are not tied to a
          project.
        </Typography>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          id="audit-search"
          label="Filter logs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Event, project, or actor"
          size="small"
          fullWidth
        />
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
          sx={{ flexShrink: 0 }}
        >
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Table size="small" aria-label="Platform audit logs">
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Event</TableCell>
            <TableCell>Project</TableCell>
            <TableCell>Actor</TableCell>
            <TableCell>Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <Typography role="status" variant="body2">
                  {loading
                    ? "Loading logs…"
                    : rows.length === 0
                      ? "No audit events yet."
                      : "No logs match this filter."}
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {visible.map((row) => {
            const details = formatAuditMetadata(row.metadata);
            const project = row.gitlabPath || row.effectiveSlug || "—";
            return (
              <TableRow key={row.id}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  {formatAuditWhen(row.createdAt)}
                </TableCell>
                <TableCell>{auditEventLabel(row.eventType)}</TableCell>
                <TableCell>{project}</TableCell>
                <TableCell>{row.actor || "—"}</TableCell>
                <TableCell
                  sx={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxWidth: 420,
                  }}
                >
                  {details || "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Stack>
  );
}
