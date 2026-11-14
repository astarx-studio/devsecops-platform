"use client";

import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  AppBar,
  Box,
  Button,
  IconButton,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect } from "react";

import { useHealth } from "@/context/HealthContext";

interface SettingsBarProps {
  sectionTitle: string;
  onOpenNavigation: () => void;
}

export function SettingsBar({ sectionTitle, onOpenNavigation }: SettingsBarProps) {
  const { healthStatus, health, refreshing, refreshHealth } = useHealth();

  const onRefresh = useCallback(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const healthy = health?.status.toLowerCase() === "ok";
  const unreachable = healthStatus?.startsWith("unreachable") ?? false;

  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "rgba(251,252,252,0.96)",
        backdropFilter: "blur(10px)",
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 64, md: 68 }, px: { xs: 1.5, sm: 3, lg: 4 }, gap: 1.5 }}>
        <IconButton
          aria-label="Open console navigation"
          onClick={onOpenNavigation}
          sx={{ display: { md: "none" } }}
        >
          <MenuOutlinedIcon />
        </IconButton>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            Control plane
          </Typography>
          <Typography variant="body2" color="text.disabled" sx={{ display: { xs: "none", sm: "block" } }}>
            /
          </Typography>
          <Typography variant="body2" fontWeight={600} noWrap>
            {sectionTitle}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: "none", lg: "block" }, mr: 1 }}
        >
          Management API
        </Typography>
        <Tooltip title={healthStatus ?? "Check management API health"} enterDelay={400}>
          <span>
            <Button
              size="small"
              variant="outlined"
              color={unreachable ? "error" : healthy ? "success" : "inherit"}
              startIcon={
                <Box
                  component="span"
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    bgcolor: unreachable ? "error.main" : healthy ? "success.main" : "warning.main",
                  }}
                />
              }
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh management API health"
              sx={{ px: 1.5 }}
            >
              {refreshing ? "Checking API" : unreachable ? "API unavailable" : healthy ? "API operational" : "Check API"}
              <RefreshIcon sx={{ ml: 0.75, fontSize: 15 }} />
            </Button>
          </span>
        </Tooltip>
      </Toolbar>
      {unreachable && (
        <Alert severity="error" square sx={{ py: 0.25 }}>
          The management API is unreachable. {healthStatus}
        </Alert>
      )}
    </AppBar>
  );
}
