/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/colorScheme.ts" --revert
 */

/* eslint-disable */

import { getKcContext } from "./KcContext";
import { applyPlatformMode, readPlatformMode, type PlatformMode } from "../theme/colorMode";

const DARK_THEME_CLASS = "pf-v5-theme-dark";

function setIsDarkModeEnabled(isDarkModeEnabled: boolean) {
    document.getElementById("root-color-scheme-style")?.remove();
    const element = document.createElement("style");
    element.id = "root-color-scheme-style";
    element.innerHTML = `:root { color-scheme: ${isDarkModeEnabled ? "dark" : "light"}; }`;
    document.head.appendChild(element);
    document.documentElement.style.removeProperty("background-color");
    document.documentElement.classList.toggle(DARK_THEME_CLASS, isDarkModeEnabled);
}

export function setPlatformAdminMode(mode: PlatformMode) {
    applyPlatformMode(mode);
    setIsDarkModeEnabled(mode === "dark");
}

export function startColorSchemeManagement() {
    const { kcContext } = getKcContext();
    if (kcContext.darkMode === false) {
        setPlatformAdminMode("light");
        return;
    }
    setPlatformAdminMode(readPlatformMode());
}
