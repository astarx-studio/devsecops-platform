'use client';

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#5c9fd4' },
    secondary: { main: '#9b8afb' },
    background: { default: '#0f1419', paper: '#1a222c' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  },
});
