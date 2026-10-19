import { createTheme } from "@mui/material/styles";
import type { PlatformMode } from "./colorMode";

export function createDawnTheme(mode: PlatformMode) {
    const dark = mode === "dark";

    return createTheme({
        palette: {
            mode,
            primary: {
                main: dark ? "#3ec6d6" : "#128ea3",
                contrastText: dark ? "#062026" : "#ffffff"
            },
            secondary: {
                main: dark ? "#f0b15a" : "#e39a3c",
                contrastText: dark ? "#2a1c0a" : "#3a2a12"
            },
            background: {
                default: "transparent",
                paper: dark ? "#1a2236" : "#fffaf4"
            },
            text: {
                primary: dark ? "#f6efe6" : "#241c18",
                secondary: dark ? "#d7c3b2" : "#6b5348"
            },
            divider: dark ? "#3a4666" : "#f0dcc8"
        },
        shape: { borderRadius: 12 },
        typography: {
            fontFamily: '"Segoe UI", system-ui, sans-serif'
        },
        components: {
            MuiButton: {
                styleOverrides: {
                    root: { textTransform: "none" }
                }
            }
        }
    });
}
