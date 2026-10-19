import { useEffect, useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ThemeProvider from "@mui/material/styles/ThemeProvider";
import Typography from "@mui/material/Typography";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import type { I18n } from "./i18n";
import type { KcContext } from "./KcContext";
import logoLight from "../assets/logo-light.png";
import logoDark from "../assets/logo-dark.png";
import faviconLight from "../assets/favicon-light.ico";
import faviconDark from "../assets/favicon-dark.ico";
import { applyPlatformFavicon, applyPlatformMode, readPlatformMode, type PlatformMode } from "../theme/colorMode";
import { createDawnTheme } from "../theme/dawnTheme";

const EMPLOYEE_REALM = "devops";

export default function Template(props: TemplateProps<KcContext, I18n>) {
    const {
        displayInfo = false,
        displayMessage = true,
        headerNode,
        socialProvidersNode = null,
        infoNode = null,
        documentTitle,
        kcContext,
        i18n,
        doUseDefaultCss,
        children
    } = props;

    const { msg, msgStr } = i18n;
    const { realm, auth, url, message, isAppInitiatedAction } = kcContext;
    const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
    const [mode, setMode] = useState<PlatformMode>(() => readPlatformMode());

    useEffect(() => {
        applyPlatformMode(mode);
        applyPlatformFavicon(mode === "dark" ? faviconDark : faviconLight);
    }, [mode]);

    useEffect(() => {
        document.title = documentTitle ?? msgStr("loginTitle", realm.displayName || realm.name);
    }, [documentTitle, msgStr, realm.displayName, realm.name]);

    if (!isReadyToRender) {
        return null;
    }

    const origin = serverOrigin(url.loginUrl);
    const employeeHref = `${origin}/realms/${EMPLOYEE_REALM}/account/`;
    const adminHref = `${origin}/admin/`;
    const isAdmin = realm.name === "master";
    const theme = createDawnTheme(mode);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <LoginFieldStyles />
            <Box
                className="platform-login"
                sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", px: 2, py: 4 }}
            >
                <Paper elevation={6} sx={{ width: "100%", maxWidth: 440, p: { xs: 3, sm: 4 }, borderTop: 4, borderColor: "secondary.main" }}>
                    <Stack spacing={2.5}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                                <Box
                                    component="img"
                                    src={mode === "dark" ? logoDark : logoLight}
                                    alt="YADA DSOaaS"
                                    sx={{ width: 36, height: 36, objectFit: "contain" }}
                                />
                                <Typography variant="h6" component="div">
                                    YADA DSOaaS
                                </Typography>
                            </Stack>
                            <IconButton
                                aria-label={mode === "dark" ? "Use the brighter dawn" : "Use the darker dawn"}
                                onClick={() => setMode(mode === "dark" ? "light" : "dark")}
                                color="inherit"
                            >
                                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
                            </IconButton>
                        </Stack>

                        <Stack spacing={1}>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                <PathButton selected={!isAdmin} href={employeeHref} label="Employee" />
                                <PathButton selected={isAdmin} href={adminHref} label="Admin" />
                            </Stack>
                            <Typography variant="body2" color="text.secondary">
                                {isAdmin ? "Sign in to look after the platform." : "Sign in to your YADA DSOaaS account."}
                            </Typography>
                        </Stack>

                        <Typography id="kc-page-title" variant="h5" component="h1">
                            {auth !== undefined && auth.showUsername && !auth.showResetCredentials ? auth.attemptedUsername : headerNode}
                        </Typography>
                        {auth !== undefined && auth.showUsername && !auth.showResetCredentials && (
                            <Button href={url.loginRestartFlowUrl} size="small">
                                {msgStr("restartLoginTooltip")}
                            </Button>
                        )}

                        {displayMessage && message !== undefined && (message.type !== "warning" || !isAppInitiatedAction) && (
                            <Alert severity={message.type === "error" ? "error" : message.type}>
                                <span dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }} />
                            </Alert>
                        )}

                        {children}

                        {auth !== undefined && auth.showTryAnotherWayLink && (
                            <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                                <input type="hidden" name="tryAnotherWay" value="on" />
                                <Button
                                    id="try-another-way"
                                    href="#"
                                    onClick={event => {
                                        event.preventDefault();
                                        document.forms.namedItem("kc-select-try-another-way-form")?.requestSubmit();
                                    }}
                                >
                                    {msg("doTryAnotherWay")}
                                </Button>
                            </form>
                        )}
                        {socialProvidersNode}
                        {displayInfo && <Box id="kc-info">{infoNode}</Box>}
                    </Stack>
                </Paper>
            </Box>
        </ThemeProvider>
    );
}

function PathButton(props: { selected: boolean; href: string; label: string }) {
    if (props.selected) {
        return (
            <Button variant="contained" color="primary" aria-current="page" sx={{ flex: 1 }}>
                {props.label}
            </Button>
        );
    }

    return (
        <Button component="a" href={props.href} variant="outlined" color="secondary" sx={{ flex: 1 }}>
            {props.label}
        </Button>
    );
}

function LoginFieldStyles() {
    return (
        <GlobalStyles
            styles={theme => ({
                ".platform-login input[type='text']:not(.MuiInputBase-input), .platform-login input[type='password']:not(.MuiInputBase-input), .platform-login input[type='email']:not(.MuiInputBase-input), .platform-login .pf-c-form-control":
                    {
                        font: "inherit",
                        width: "100%",
                        boxSizing: "border-box",
                        borderRadius: 8,
                        border: `1px solid ${theme.palette.divider}`,
                        background: theme.palette.background.paper,
                        color: theme.palette.text.primary,
                        padding: "14px 12px"
                    },
                ".platform-login label:not(.MuiFormLabel-root):not(.MuiFormControlLabel-label)": {
                    color: theme.palette.text.secondary,
                    fontSize: "0.875rem"
                },
                ".platform-login a:not(.MuiLink-root):not(.MuiButton-root)": {
                    color: theme.palette.secondary.main
                },
                ".platform-login input[type='submit']": {
                    width: "100%",
                    marginTop: 8,
                    border: 0,
                    borderRadius: 8,
                    padding: "12px 16px",
                    font: "inherit",
                    fontWeight: 650,
                    cursor: "pointer",
                    background: theme.palette.primary.main,
                    color: theme.palette.primary.contrastText
                }
            })}
        />
    );
}

function serverOrigin(loginUrl: string) {
    try {
        return new URL(loginUrl, window.location.origin).origin;
    } catch {
        return window.location.origin;
    }
}
