import { Suspense, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import CssBaseline from "@mui/material/CssBaseline";
import Drawer from "@mui/material/Drawer";
import { ThemeProvider } from "@mui/material/styles";
import { AlertVariant } from "../../shared/@patternfly/react-core";
import {
    useAlerts,
    useEnvironment,
    type KeycloakContext
} from "../../shared/keycloak-ui-shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
    createBrowserRouter,
    Navigate,
    Outlet,
    RouterProvider,
    type RouteObject
} from "react-router-dom";
import type { AccountEnvironment } from "..";
import fetchContentJson from "../content/fetchContent";
import { routes } from "../routes";
import { createDawnTheme } from "../../theme/dawnTheme";
import { usePromise } from "../utils/usePromise";
import { AccountProfileProvider } from "./AccountProfile";
import { Header, useAccountMode } from "./Header";
import { type MenuItem, PageNav } from "./PageNav";

const drawerWidth = 260;

function mapRoutes(
    context: KeycloakContext<AccountEnvironment>,
    content: MenuItem[]
): RouteObject[] {
    return content.flatMap(item => {
        if ("children" in item) {
            return mapRoutes(context, item.children);
        }
        if (item.isVisible && !context.environment.features[item.isVisible]) {
            return [];
        }
        return [
            {
                path: item.path,
                element: routes.find(route => route.path === (item.id ?? item.path))
                    ?.element
            }
        ];
    });
}

function CatchAllRedirect() {
    const { t } = useTranslation();
    const { addAlert } = useAlerts();

    useEffect(() => {
        addAlert(t("pageNotFound"), AlertVariant.warning);
    }, [addAlert, t]);

    return <Navigate to="." replace />;
}

function AccountFrame() {
    const { mode, setMode } = useAccountMode();
    const [navOpen, setNavOpen] = useState(false);
    const theme = createDawnTheme(mode);

    const drawer = <PageNav />;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <AccountProfileProvider>
                <Box sx={{ display: "flex", minHeight: "100vh" }}>
                    <Header
                        mode={mode}
                        onToggleMode={() => setMode(mode === "dark" ? "light" : "dark")}
                        onOpenNav={() => setNavOpen(true)}
                    />
                    <Drawer
                        variant="temporary"
                        open={navOpen}
                        onClose={() => setNavOpen(false)}
                        ModalProps={{ keepMounted: true }}
                        sx={{
                            display: { xs: "block", md: "none" },
                            "& .MuiDrawer-paper": {
                                width: drawerWidth,
                                boxSizing: "border-box"
                            }
                        }}
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
                            "& .MuiDrawer-paper": {
                                width: drawerWidth,
                                boxSizing: "border-box",
                                backgroundImage: "none"
                            }
                        }}
                        PaperProps={{ className: "platform-sidebar" }}
                        open
                    >
                        <ToolbarSpacer />
                        {drawer}
                    </Drawer>
                    <Box
                        component="main"
                        sx={{
                            flexGrow: 1,
                            p: { xs: 2, sm: 4 },
                            width: { md: `calc(100% - ${drawerWidth}px)` }
                        }}
                    >
                        <ToolbarSpacer />
                        <Suspense
                            fallback={
                                <Box
                                    sx={{
                                        display: "flex",
                                        justifyContent: "center",
                                        py: 8
                                    }}
                                >
                                    <CircularProgress />
                                </Box>
                            }
                        >
                            <Outlet />
                        </Suspense>
                    </Box>
                </Box>
            </AccountProfileProvider>
        </ThemeProvider>
    );
}

function ToolbarSpacer() {
    return <Box sx={{ height: 64 }} />;
}

export const Root = () => {
    const context = useEnvironment<AccountEnvironment>();
    const [content, setContent] = useState<RouteObject[]>();

    usePromise(
        signal => fetchContentJson({ signal, context }),
        content => {
            setContent([
                {
                    path: decodeURIComponent(
                        new URL(context.environment.baseUrl).pathname
                    ),
                    element: <AccountFrame />,
                    children: [
                        ...mapRoutes(context, content),
                        { path: "*", element: <CatchAllRedirect /> }
                    ]
                }
            ]);
        }
    );

    if (!content) {
        return (
            <Box
                sx={{
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    return <RouterProvider router={createBrowserRouter(content)} />;
};
