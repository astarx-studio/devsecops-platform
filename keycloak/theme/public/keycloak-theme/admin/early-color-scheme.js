/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/early-color-scheme.js" --public --revert
 */

{
    const DARK_THEME_CLASS = "pf-v5-theme-dark";
    let mode = "light";
    try {
        if (window.localStorage.getItem("platform-color-mode") === "dark") {
            mode = "dark";
        }
    } catch {
        /* storage can be blocked */
    }
    if (typeof kcContext !== "undefined" && kcContext.darkMode === false) {
        mode = "light";
    }

    const isDarkModeEnabled = mode === "dark";
    const element = document.createElement("style");
    element.id = "root-color-scheme-style";
    element.innerHTML = `:root { color-scheme: ${isDarkModeEnabled ? "dark" : "light"}; }`;
    document.head.appendChild(element);
    document.documentElement.setAttribute("data-platform-mode", mode);
    document.documentElement.classList.toggle(DARK_THEME_CLASS, isDarkModeEnabled);
}
