"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  Button,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from "@mui/material";
import { useCallback, useState } from "react";

import {
  createEnvRowId,
  type EnvKeyValueRow,
} from "@/lib/env-dotenv";

interface Props {
  rows: EnvKeyValueRow[];
  onChange: (rows: EnvKeyValueRow[]) => void;
  /** When true, values use password masking with per-row reveal. */
  maskValues?: boolean;
  disabled?: boolean;
}

/**
 * Shared KEY=value row editor for env profile create and details dialogs.
 */
export function EnvKeyValueEditor({
  rows,
  onChange,
  maskValues = false,
  disabled = false,
}: Props) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const updateRow = useCallback(
    (id: string, patch: Partial<Pick<EnvKeyValueRow, "key" | "value">>) => {
      onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [onChange, rows],
  );

  const removeRow = useCallback(
    (id: string) => {
      const next = rows.filter((r) => r.id !== id);
      onChange(next.length ? next : [{ id: createEnvRowId(), key: "", value: "" }]);
      setRevealed((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    },
    [onChange, rows],
  );

  const addRow = useCallback(() => {
    onChange([...rows, { id: createEnvRowId(), key: "", value: "" }]);
  }, [onChange, rows]);

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <Stack spacing={1}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width="36%">Key</TableCell>
            <TableCell>Value</TableCell>
            <TableCell align="right" width={120}>
              Actions
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const showPlain = !maskValues || !!revealed[row.id];
            return (
              <TableRow key={row.id}>
                <TableCell sx={{ verticalAlign: "top" }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="KEY"
                    value={row.key}
                    disabled={disabled}
                    onChange={(e) => updateRow(row.id, { key: e.target.value })}
                    slotProps={{ htmlInput: { "aria-label": "Env key" } }}
                  />
                </TableCell>
                <TableCell sx={{ verticalAlign: "top" }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="value"
                    type={showPlain ? "text" : "password"}
                    value={row.value}
                    disabled={disabled}
                    onChange={(e) =>
                      updateRow(row.id, { value: e.target.value })
                    }
                    autoComplete="off"
                    slotProps={{ htmlInput: { "aria-label": "Env value" } }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  {maskValues && (
                    <Tooltip title={showPlain ? "Hide value" : "Reveal value"}>
                      <IconButton
                        size="small"
                        disabled={disabled}
                        onClick={() => toggleReveal(row.id)}
                        aria-label={showPlain ? "Hide value" : "Reveal value"}
                      >
                        {showPlain ? (
                          <VisibilityOffIcon fontSize="small" />
                        ) : (
                          <VisibilityIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Remove variable">
                    <IconButton
                      size="small"
                      disabled={disabled}
                      onClick={() => removeRow(row.id)}
                      aria-label="Remove variable"
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Button
        size="small"
        startIcon={<AddIcon />}
        disabled={disabled}
        onClick={addRow}
        sx={{ alignSelf: "flex-start" }}
      >
        Add variable
      </Button>
    </Stack>
  );
}
