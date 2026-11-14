"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0f6b63",
      dark: "#0a504a",
      light: "#e4f2ef",
      contrastText: "#f7fcfb",
    },
    secondary: { main: "#425466" },
    background: { default: "#f4f6f7", paper: "#fbfcfc" },
    text: { primary: "#18262e", secondary: "#52636d", disabled: "#84929a" },
    success: { main: "#19744d", light: "#e7f4ed", contrastText: "#f7fcfa" },
    warning: { main: "#96600a", light: "#fbf1dc", contrastText: "#241a09" },
    error: { main: "#b43832", light: "#faece9", contrastText: "#fff8f6" },
    info: { main: "#25658a", light: "#e8f1f6", contrastText: "#f7fbfd" },
    divider: "#dbe2e5",
  },
  shape: { borderRadius: 7 },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
    fontSize: 16,
    h4: { fontSize: 28, lineHeight: 1.25, fontWeight: 600, letterSpacing: -0.45 },
    h5: { fontSize: 22, lineHeight: 1.3, fontWeight: 600, letterSpacing: -0.25 },
    h6: { fontSize: 16, lineHeight: 1.4, fontWeight: 600 },
    subtitle1: { fontSize: 16, lineHeight: 1.5, fontWeight: 500 },
    body1: { fontSize: 16, lineHeight: 1.6 },
    body2: { fontSize: 14, lineHeight: 1.55 },
    caption: { fontSize: 12, lineHeight: 1.5 },
    button: { fontSize: 14, fontWeight: 500 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minHeight: "100%" },
        body: { minHeight: "100dvh" },
        "code, pre": { fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.92em" },
        "::selection": { backgroundColor: "#c8e5df" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
        "a:focus-visible, button:focus-visible, [tabindex]:focus-visible": {
          outline: "2px solid #0f6b63",
          outlineOffset: "2px",
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: "none" },
        rounded: { border: "1px solid #dbe2e5" },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          paddingInline: 14,
          borderRadius: 6,
          textTransform: "none",
          whiteSpace: "nowrap",
          "@media (pointer: coarse)": { minHeight: 44 },
        },
        contained: { "&:hover": { boxShadow: "none" } },
        outlined: { borderColor: "#c7d2d7", backgroundColor: "#fbfcfc" },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { minWidth: 40, minHeight: 40, borderRadius: 6, "@media (pointer: coarse)": { minWidth: 44, minHeight: 44 } },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: { "&.Mui-disabled": { cursor: "not-allowed" } },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 46,
          paddingInline: 16,
          textTransform: "none",
          fontSize: 14,
          fontWeight: 500,
          "&.Mui-selected": { fontWeight: 600 },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 2, borderRadius: "2px 2px 0 0" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { height: 24, borderRadius: 5, fontSize: 12, fontWeight: 500 },
        outlined: { borderColor: "#cbd6da" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: "#fbfcfc", borderRadius: 6 },
        notchedOutline: { borderColor: "#c9d4d8" },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: 14 } },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { marginLeft: 0, fontSize: 12, lineHeight: 1.5 } },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-root": {
            backgroundColor: "#f2f5f6",
            color: "#52636d",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.25,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: 14, borderBottomColor: "#e2e8ea" },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { "&:hover": { backgroundColor: "rgba(15,107,99,0.025)" } },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { border: "1px solid", borderRadius: 7, fontSize: 14 },
        standardError: { borderColor: "#ecc7c2" },
        standardWarning: { borderColor: "#ead6ad" },
        standardSuccess: { borderColor: "#bfddcc" },
        standardInfo: { borderColor: "#c4d9e5" },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { border: "1px solid #dbe2e5", boxShadow: "0 20px 60px rgba(20,33,41,0.2)" },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: "#20313a", fontSize: 12 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: "#e1e9e8" },
      },
    },
  },
});
