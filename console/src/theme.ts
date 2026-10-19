'use client';

import { createTheme } from '@mui/material/styles';

/**
 * Dark operator theme tuned for WCAG contrast and a visible keyboard focus ring.
 * Primary/text colors are lighter than the previous palette so they stay readable
 * on #0f1419 / #1a222c.
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#9fd0f5' },
    secondary: { main: '#d4c6ff' },
    background: { default: '#0f1419', paper: '#1a222c' },
    text: {
      primary: '#f4f7fa',
      secondary: '#c9d4df',
    },
    warning: { main: '#f6c56b' },
    error: { main: '#ff9b93' },
    success: { main: '#9ed9ae' },
    info: { main: '#9fd0f5' },
    divider: '#3d4c5c',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
    fontSize: 16,
    body1: { lineHeight: 1.6 },
    body2: { lineHeight: 1.6 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
        'a:focus-visible, button:focus-visible, [tabindex]:focus-visible': {
          outline: '3px solid #9fd0f5',
          outlineOffset: '2px',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { minWidth: 44, minHeight: 44 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 44, textTransform: 'none' },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 48, textTransform: 'none' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
});
