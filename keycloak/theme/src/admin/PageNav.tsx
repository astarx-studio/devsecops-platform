/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/PageNav.tsx" --revert
 */

/* eslint-disable */

// @ts-nocheck

import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useEnvironment } from "../shared/keycloak-ui-shared";
import { useAccess } from "./context/access/Access";
import { useRealm } from "./context/realm-context/RealmContext";
import { useServerInfo } from "./context/server-info/ServerInfoProvider";
import type { Environment } from "./environment-types";
import { toPage } from "./page/routes";
import { routes } from "./routes";
import useIsFeatureEnabled, { Feature } from "./utils/useIsFeatureEnabled";

const navItemSx = {
    borderRadius: 2,
    mb: 0.5,
    mx: 1,
    border: "1px solid #fff",
    color: "inherit",
    '&[aria-current="page"]': {
        bgcolor: "color-mix(in srgb, var(--platform-surface) 78%, transparent)",
        "&:hover": {
            bgcolor: "color-mix(in srgb, var(--platform-surface) 90%, transparent)"
        }
    }
};

const LeftNav = ({ title, path, id }: { title: string; path: string; id?: string }) => {
    const { t } = useTranslation();
    const { hasAccess } = useAccess();
    const { realm } = useRealm();
    const encodedRealm = encodeURIComponent(realm);
    const route = routes.find(route => route.path.replace(/\/:.+?(\?|(?:(?!\/).)*|$)/g, "") === (id || path));
    const accessAllowed = route && (route.handle.access instanceof Array ? hasAccess(...route.handle.access) : hasAccess(route.handle.access));

    if (!accessAllowed) {
        return null;
    }

    const name = "nav-item" + path.replace("/", "-");
    return (
        <ListItemButton
            id={name}
            data-testid={name}
            component={NavLink}
            to={`/${encodedRealm}${path}`}
            sx={navItemSx}
        >
            <ListItemText primary={t(title)} />
        </ListItemButton>
    );
};

function NavSection({ title, children }: { title?: string; children: React.ReactNode }) {
    return (
        <Stack component="section" spacing={0.5} sx={{ mb: 2 }}>
            {title && (
                <Typography variant="overline" sx={{ px: 2, color: "inherit", opacity: 0.8 }}>
                    {title}
                </Typography>
            )}
            <List disablePadding>{children}</List>
        </Stack>
    );
}

export const PageNav = () => {
    const { t } = useTranslation();
    const { environment } = useEnvironment<Environment>();
    const { hasSomeAccess } = useAccess();
    const { componentTypes } = useServerInfo();
    const isFeatureEnabled = useIsFeatureEnabled();
    const pages = componentTypes?.["org.keycloak.services.ui.extend.UiPageProvider"];
    const { realmRepresentation } = useRealm();

    const showManage = hasSomeAccess("view-realm", "query-groups", "query-users", "query-clients", "query-organizations", "view-events");
    const showConfigure = hasSomeAccess("view-realm", "query-clients", "view-identity-providers");
    const showWorkflows = hasSomeAccess("realm-admin", "admin") && isFeatureEnabled(Feature.Workflows);
    const showManageRealm = environment.masterRealm === environment.realm;

    return (
        <Stack component="nav" sx={{ py: 2, color: "var(--platform-text)" }}>
            {showManageRealm && (
                <NavSection>
                    <LeftNav title={t("manageRealms")} path="/realms" />
                </NavSection>
            )}
            {showManage && (
                <NavSection title={t("manage")}>
                    {isFeatureEnabled(Feature.Organizations) &&
                        realmRepresentation.organizationsEnabled && (
                            <LeftNav title="organizations" path="/organizations" />
                        )}
                    <LeftNav title="clients" path="/clients" />
                    <LeftNav title="clientScopes" path="/client-scopes" />
                    <LeftNav title="realmRoles" path="/roles" />
                    <LeftNav title="users" path="/users" />
                    <LeftNav title="groups" path="/groups" />
                    <LeftNav title="sessions" path="/sessions" />
                    <LeftNav title="events" path="/events" />
                </NavSection>
            )}
            {showConfigure && (
                <NavSection title={t("configure")}>
                    <LeftNav title="realmSettings" path="/realm-settings" />
                    <LeftNav title="authentication" path="/authentication" />
                    {isFeatureEnabled(Feature.AdminFineGrainedAuthzV2) &&
                        realmRepresentation.adminPermissionsEnabled && (
                            <LeftNav title="permissions" path="/permissions" />
                        )}
                    <LeftNav title="identityProviders" path="/identity-providers" />
                    <LeftNav title="userFederation" path="/user-federation" />
                    {showWorkflows && <LeftNav title="workflows" path="/workflows" />}
                    {isFeatureEnabled(Feature.DeclarativeUI) &&
                        pages?.map(page => (
                            <LeftNav
                                key={page.id}
                                title={page.id}
                                path={toPage({ providerId: page.id }).pathname!}
                                id="/page-section"
                            />
                        ))}
                </NavSection>
            )}
        </Stack>
    );
};
