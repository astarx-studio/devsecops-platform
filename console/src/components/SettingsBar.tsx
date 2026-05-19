'use client';

import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, AppBar, Box, Button, Stack, Toolbar, Typography } from '@mui/material';
import { useCallback, useEffect } from 'react';

import { useHealth } from '@/context/HealthContext';

export function SettingsBar() {
  const { healthStatus, refreshHealth } = useHealth();

  const onRefresh = useCallback(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider' }}
    >
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
        <Typography variant="h6" sx={{ mr: 1, fontWeight: 600 }}>
          DSOaaS Management
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          operator console
        </Typography>
        <Stack direction="row" spacing={1} flex={1} flexWrap="wrap" useFlexGap justifyContent="flex-end">
          <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh} variant="outlined">
            API health
          </Button>
        </Stack>
        {healthStatus && (
          <Box sx={{ width: '100%' }}>
            <Alert
              severity={healthStatus.startsWith('ok') ? 'success' : 'warning'}
              sx={{ py: 0 }}
            >
              API: {healthStatus}
            </Alert>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
}
