"use client";

import { CircularProgress, Stack, Typography } from "@mui/material";

export function PanelFallback({ label }: { label: string }) {
  return (
    <Stack
      role="status"
      aria-live="polite"
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 3, px: 1 }}
    >
      <CircularProgress size={22} aria-hidden />
      <Typography color="text.secondary">Loading {label}</Typography>
    </Stack>
  );
}
