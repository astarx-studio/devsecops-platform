/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/PageHeader.tsx" --revert
 */

/* eslint-disable */

// @ts-nocheck

import { useMemo, useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useEnvironment, useFetch } from "../shared/keycloak-ui-shared";
import logoLight from "../assets/logo-light.png";
import logoDark from "../assets/logo-dark.png";
import faviconLight from "../assets/favicon-light.ico";
import faviconDark from "../assets/favicon-dark.ico";
import { applyPlatformFavicon, type PlatformMode } from "../theme/colorMode";
import { useAdminClient } from "./admin-client";
import { PageHeaderClearCachesModal } from "./PageHeaderClearCachesModal";
import { HelpHeader } from "./components/help-enabler/HelpHeader";
import { useAccess } from "./context/access/Access";
import { fetchAdminUI } from "./context/auth/admin-ui-endpoint";
import { useRealm } from "./context/realm-context/RealmContext";
import { useWhoAmI } from "./context/whoami/WhoAmI";
import { toDashboard } from "./dashboard/routes/Dashboard";
import type { Environment } from "./environment-types";
import { useIsFeatureDisabled, Feature } from "./utils/useIsFeatureEnabled";
import { setPlatformAdminMode } from "./colorScheme";

type RealmChoice = {
    name: string;
    displayName?: string;
};

const RealmSwitch = () => {
    const { realm } = useRealm();
    const { adminClient } = useAdminClient();
    const navigate = useNavigate();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [query, setQuery] = useState("");
    const [realms, setRealms] = useState<RealmChoice[]>([]);

    useFetch(
        async () => {
            try {
                return await fetchAdminUI<RealmChoice[]>(
                    adminClient,
                    "ui-ext/realms/names",
                    {
                        first: "0",
                        max: "100",
                        search: ""
                    }
                );
            } catch {
                return [];
            }
        },
        setRealms,
        [realm]
    );

    const choices = useMemo(() => {
        const byName = new Map<string, RealmChoice>();
        byName.set(realm, { name: realm });
        for (const item of realms) {
            if (item?.name) {
                byName.set(item.name, item);
            }
        }
        const needle = query.trim().toLowerCase();
        return [...byName.values()]
            .filter(item => !needle || item.name.toLowerCase().includes(needle))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [realm, realms, query]);

    return (
        <>
            <Button
                color="inherit"
                variant="outlined"
                size="small"
                data-testid="realm-switcher"
                aria-label="Switch realm"
                aria-haspopup="listbox"
                aria-expanded={Boolean(anchor)}
                endIcon={<ArrowDropDownIcon />}
                onClick={event => setAnchor(event.currentTarget)}
                sx={{
                    ml: 1.5,
                    borderColor: "divider",
                    textTransform: "none",
                    maxWidth: { xs: 140, sm: 240 },
                    flexShrink: 1
                }}
            >
                <Box
                    component="span"
                    sx={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                    {realm}
                </Box>
            </Button>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => {
                    setAnchor(null);
                    setQuery("");
                }}
            >
                {realms.length > 6 && (
                    <MenuItem
                        disableRipple
                        sx={{
                            cursor: "default",
                            "&:hover": { backgroundColor: "transparent" }
                        }}
                        onKeyDown={event => event.stopPropagation()}
                    >
                        <TextField
                            autoFocus
                            size="small"
                            placeholder="Find a realm"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onClick={event => event.stopPropagation()}
                            onKeyDown={event => event.stopPropagation()}
                            sx={{ width: 220 }}
                        />
                    </MenuItem>
                )}
                {choices.map(item => (
                    <MenuItem
                        key={item.name}
                        selected={item.name === realm}
                        onClick={() => {
                            setAnchor(null);
                            setQuery("");
                            if (item.name !== realm) {
                                navigate(toDashboard({ realm: item.name }));
                            }
                        }}
                    >
                        {item.name}
                    </MenuItem>
                ))}
                {choices.length === 0 && <MenuItem disabled>No matching realm</MenuItem>}
            </Menu>
        </>
    );
};

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
                        textDecoration: "none"
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
                <RealmSwitch />
                <Box sx={{ flexGrow: 1 }} />
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
