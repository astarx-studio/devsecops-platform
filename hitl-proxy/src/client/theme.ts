import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0f4c5c' },
    secondary: { main: '#e36414' },
    background: { default: '#f3f5f7', paper: '#ffffff' },
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600 },
      },
    },
  },
});
