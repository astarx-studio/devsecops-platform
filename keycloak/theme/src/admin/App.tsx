/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/App.tsx" --revert
 */

/* eslint-disable */

// @ts-nocheck

import { useState } from "react";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Drawer from "@mui/material/Drawer";
import { ThemeProvider } from "@mui/material/styles";
import { Suspense, useEffect, type PropsWithChildren } from "react";
import { Outlet } from "react-router-dom";
import { SessionExpirationWarningOverlay } from "../shared/SessionExpirationWarningOverlay";
import { ErrorBoundaryFallback, ErrorBoundaryProvider, KeycloakSpinner, mainPageContentId } from "../shared/keycloak-ui-shared";
import { createDawnTheme } from "../theme/dawnTheme";
import { readPlatformMode, type PlatformMode } from "../theme/colorMode";
import { AdminClientProvider } from "./admin-client";
import { Banners } from "./Banners";
import { PageBreadCrumbs } from "./components/bread-crumb/PageBreadCrumbs";
import { ErrorRenderer } from "./components/error/ErrorRenderer";
import { AccessContextProvider } from "./context/access/Access";
import { RealmContextProvider } from "./context/realm-context/RealmContext";
import { RecentRealmsProvider } from "./context/RecentRealms";
import { ServerInfoProvider } from "./context/server-info/ServerInfoProvider";
import { WhoAmIContextProvider } from "./context/whoami/WhoAmI";
import { SubGroups } from "./groups/SubGroupsContext";
import { Header } from "./PageHeader";
import { PageNav } from "./PageNav";
import { AuthWall } from "./root/AuthWall";

const drawerWidth = 280;

export const AppContexts = ({ children }: PropsWithChildren) => (
    <ErrorBoundaryProvider>
        <ErrorBoundaryFallback fallback={ErrorRenderer}>
            <ServerInfoProvider>
                <RealmContextProvider>
                    <WhoAmIContextProvider>
                        <RecentRealmsProvider>
                            <AccessContextProvider>
                                <SubGroups>{children}</SubGroups>
                            </AccessContextProvider>
                        </RecentRealmsProvider>
                    </WhoAmIContextProvider>
                </RealmContextProvider>
            </ServerInfoProvider>
        </ErrorBoundaryFallback>
    </ErrorBoundaryProvider>
);

export const App = () => {
    const hrefEndsWithHashSlash = location.href.endsWith("#/");
    const [mode, setMode] = useState<PlatformMode>(() => readPlatformMode());
    const [navOpen, setNavOpen] = useState(false);

    useEffect(() => {
        if (!hrefEndsWithHashSlash) return;
        history.replaceState(null, "", location.pathname);
    }, [hrefEndsWithHashSlash, location.pathname]);

    const drawer = (
        <Box sx={{ overflow: "auto", height: "100%" }}>
            <PageNav />
        </Box>
    );

    return (
        <AdminClientProvider>
            <AppContexts>
                <ThemeProvider theme={createDawnTheme(mode)}>
                    <CssBaseline />
                    <Box sx={{ display: "flex", minHeight: "100vh" }}>
                        <Header mode={mode} onToggleMode={() => setMode(mode === "dark" ? "light" : "dark")} onOpenNav={() => setNavOpen(true)} />
                        <Drawer
                            variant="temporary"
                            open={navOpen}
                            onClose={() => setNavOpen(false)}
                            ModalProps={{ keepMounted: true }}
                            sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" } }}
                            PaperProps={{ className: "platform-sidebar" }}
                        >
                            <ToolbarSpacer />
                            {drawer}
                        </Drawer>
                        <Drawer
                            variant="permanent"
                            sx={{
                                display: { xs: "none", md: "block" },
                                width: drawerWidth,
                                flexShrink: 0,
                                "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" }
                            }}
                            PaperProps={{ className: "platform-sidebar" }}
                            open
                        >
                            <ToolbarSpacer />
                            {drawer}
                        </Drawer>
                        <Box
                            id={mainPageContentId}
                            component="main"
                            sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, sm: 3 }, width: { md: `calc(100% - ${drawerWidth}px)` } }}
                        >
                            <ToolbarSpacer />
                            <Banners />
                            <PageBreadCrumbs />
                            <ErrorBoundaryFallback fallback={ErrorRenderer}>
                                <Suspense fallback={<KeycloakSpinner />}>
                                    <AuthWall>
                                        <Outlet />
                                    </AuthWall>
                                </Suspense>
                            </ErrorBoundaryFallback>
                        </Box>
                    </Box>
                </ThemeProvider>
                <SessionExpirationWarningOverlay warnUserSecondsBeforeAutoLogout={45} />
            </AppContexts>
        </AdminClientProvider>
    );
};

function ToolbarSpacer() {
    return <Box sx={{ height: 64, flexShrink: 0 }} />;
}
