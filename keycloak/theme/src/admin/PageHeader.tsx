/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/PageHeader.tsx" --revert
 */

/* eslint-disable */

// @ts-nocheck

import { useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEnvironment } from "../shared/keycloak-ui-shared";
import logoLight from "../assets/logo-light.png";
import logoDark from "../assets/logo-dark.png";
import faviconLight from "../assets/favicon-light.ico";
import faviconDark from "../assets/favicon-dark.ico";
import { applyPlatformFavicon, type PlatformMode } from "../theme/colorMode";
import { PageHeaderClearCachesModal } from "./PageHeaderClearCachesModal";
import { HelpHeader } from "./components/help-enabler/HelpHeader";
import { useAccess } from "./context/access/Access";
import { useRealm } from "./context/realm-context/RealmContext";
import { useWhoAmI } from "./context/whoami/WhoAmI";
import { toDashboard } from "./dashboard/routes/Dashboard";
import type { Environment } from "./environment-types";
import { useIsFeatureDisabled, Feature } from "./utils/useIsFeatureEnabled";
import { setPlatformAdminMode } from "./colorScheme";

type HeaderProps = {
    mode: PlatformMode;
    onToggleMode: () => void;
    onOpenNav: () => void;
};

export const Header = ({ mode, onToggleMode, onOpenNav }: HeaderProps) => {
    const { environment, keycloak } = useEnvironment<Environment>();
    const { t } = useTranslation();
    const { realm } = useRealm();
    const { hasAccess } = useAccess();
    const { whoAmI } = useWhoAmI();
    const isFeatureDisabled = useIsFeatureDisabled();
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [clearCachesOpen, setClearCachesOpen] = useState(false);
    const token = keycloak.idTokenParsed ?? keycloak.tokenParsed;
    const givenName = token?.given_name;
    const familyName = token?.family_name;
    const username =
        whoAmI.displayName ||
        (givenName && familyName
            ? t("fullName", { givenName, familyName })
            : givenName || familyName || token?.preferred_username || t("unknownUser"));
    const isMasterRealm = realm === environment.masterRealm;
    const isManager = hasAccess("manage-realm");

    applyPlatformFavicon(mode === "dark" ? faviconDark : faviconLight);

    return (
        <AppBar
            position="fixed"
            color="inherit"
            elevation={0}
            sx={{
                zIndex: theme => theme.zIndex.drawer + 1,
                borderBottom: 1,
                borderColor: "divider",
                backgroundImage: "none"
            }}
        >
            <Toolbar>
                <IconButton
                    edge="start"
                    aria-label="Open admin menu"
                    onClick={onOpenNav}
                    sx={{ mr: 1, display: { md: "none" } }}
                >
                    <MenuIcon />
                </IconButton>
                <Box
                    component={Link}
                    to={toDashboard({ realm })}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        color: "inherit",
                        textDecoration: "none",
                        flexGrow: 1
                    }}
                >
                    <Box
                        component="img"
                        src={mode === "dark" ? logoDark : logoLight}
                        alt="YADA DSOaaS"
                        sx={{ width: 32, height: 32, mr: 1.25 }}
                    />
                    <Typography variant="h6">YADA DSOaaS</Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <HelpHeader />
                    <IconButton
                        aria-label={
                            mode === "dark"
                                ? "Use the brighter dawn"
                                : "Use the darker dawn"
                        }
                        onClick={() => {
                            const next = mode === "dark" ? "light" : "dark";
                            setPlatformAdminMode(next);
                            onToggleMode();
                        }}
                    >
                        {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
                    </IconButton>
                    <Button
                        color="inherit"
                        aria-label={username}
                        onClick={event => setMenuAnchor(event.currentTarget)}
                        sx={{ textTransform: "none" }}
                    >
                        {username}
                    </Button>
                    <Menu
                        anchorEl={menuAnchor}
                        open={Boolean(menuAnchor)}
                        onClose={() => setMenuAnchor(null)}
                    >
                        {!isFeatureDisabled(Feature.AccountV3) && (
                            <MenuItem
                                onClick={() => {
                                    setMenuAnchor(null);
                                    keycloak.accountManagement();
                                }}
                            >
                                {t("manageAccount")}
                            </MenuItem>
                        )}
                        <MenuItem
                            component={Link}
                            to={toDashboard({ realm })}
                            onClick={() => setMenuAnchor(null)}
                        >
                            {t("realmInfo")}
                        </MenuItem>
                        {isMasterRealm && isManager && (
                            <MenuItem
                                onClick={() => {
                                    setMenuAnchor(null);
                                    setClearCachesOpen(true);
                                }}
                            >
                                {t("clearCachesTitle")}
                            </MenuItem>
                        )}
                        <MenuItem
                            onClick={() => {
                                setMenuAnchor(null);
                                keycloak.logout();
                            }}
                        >
                            {t("signOut")}
                        </MenuItem>
                    </Menu>
                </Stack>
            </Toolbar>
            {clearCachesOpen && (
                <PageHeaderClearCachesModal onClose={() => setClearCachesOpen(false)} />
            )}
        </AppBar>
    );
};
