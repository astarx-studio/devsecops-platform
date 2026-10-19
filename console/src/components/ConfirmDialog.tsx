"use client";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  /** When set, the operator must type this exact value before confirm. */
  typedMatch?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  busy = false,
  typedMatch,
  onClose,
  onConfirm,
}: Props) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open]);

  const matches = !typedMatch || typed.trim() === typedMatch;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: typedMatch ? 2 : 0 }}>
          {message}
        </DialogContentText>
        {typedMatch && (
          <TextField
            autoFocus
            fullWidth
            id="confirm-typed-match"
            label={`Type ${typedMatch} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            error={typed.length > 0 && !matches}
            helperText={
              typed.length > 0 && !matches
                ? "The typed value does not match yet."
                : "Confirm stays disabled until this matches exactly."
            }
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={busy || !matches}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
