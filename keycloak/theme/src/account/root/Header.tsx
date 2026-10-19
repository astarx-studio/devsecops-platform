import { useState } from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useTranslation } from "react-i18next";
import { label, useEnvironment } from "../../shared/keycloak-ui-shared";
import logoLight from "../../assets/logo-light.png";
import logoDark from "../../assets/logo-dark.png";
import faviconLight from "../../assets/favicon-light.ico";
import faviconDark from "../../assets/favicon-dark.ico";
import type { AccountEnvironment } from "..";
import { AccountAvatar } from "../components/AccountAvatar";
import { useAccountProfile } from "./AccountProfile";
import {
    applyPlatformFavicon,
    applyPlatformMode,
    type PlatformMode
} from "../../theme/colorMode";

type HeaderProps = {
    mode: PlatformMode;
    onToggleMode: () => void;
    onOpenNav: () => void;
};

export const Header = ({ mode, onToggleMode, onOpenNav }: HeaderProps) => {
    const { environment, keycloak } = useEnvironment<AccountEnvironment>();
    const { t } = useTranslation();
    const username =
        keycloak.tokenParsed?.preferred_username || keycloak.tokenParsed?.name || "";
    const profile = useAccountProfile();
    const displayName = profile.name || username;

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
                    aria-label="Open account menu"
                    onClick={onOpenNav}
                    sx={{ mr: 1, display: { md: "none" } }}
                >
                    <MenuIcon />
                </IconButton>
                <Box
                    component="img"
                    src={mode === "dark" ? logoDark : logoLight}
                    alt="YADA DSOaaS"
                    sx={{ width: 32, height: 32, mr: 1.25 }}
                />
                <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                    YADA DSOaaS
                </Typography>
                {environment.referrerUrl && (
                    <Button
                        data-testid="referrer-link"
                        href={environment.referrerUrl.replace("_hash_", "#")}
                        endIcon={<OpenInNewIcon />}
                    >
                        {t("backTo", {
                            app: label(
                                t,
                                environment.referrerName,
                                environment.referrerUrl
                            )
                        })}
                    </Button>
                )}
                {displayName && (
                    <Stack direction="row" spacing={1} sx={{ mx: 1, alignItems: "center" }}>
                        <AccountAvatar
                            name={displayName}
                            email={profile.email}
                            picture={profile.picture}
                            size={32}
                        />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ display: { xs: "none", sm: "block" } }}
                        >
                            {displayName}
                        </Typography>
                    </Stack>
                )}
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <IconButton
                        aria-label={
                            mode === "dark"
                                ? "Use the brighter dawn"
                                : "Use the darker dawn"
                        }
                        onClick={() => {
                            const next = mode === "dark" ? "light" : "dark";
                            applyPlatformMode(next);
                            applyPlatformFavicon(
                                next === "dark" ? faviconDark : faviconLight
                            );
                            onToggleMode();
                        }}
                        color="inherit"
                    >
                        {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
                    </IconButton>
                    <Button color="inherit" onClick={() => keycloak.logout()}>
                        {t("signOut")}
                    </Button>
                </Stack>
            </Toolbar>
        </AppBar>
    );
};

export function useAccountMode() {
    const [mode, setMode] = useState<PlatformMode>(() => {
        const stored =
            window.localStorage.getItem("platform-color-mode") === "dark"
                ? "dark"
                : "light";
        applyPlatformMode(stored);
        applyPlatformFavicon(stored === "dark" ? faviconDark : faviconLight);
        return stored;
    });
    return { mode, setMode };
}
