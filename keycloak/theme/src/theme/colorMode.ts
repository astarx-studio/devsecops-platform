export type PlatformMode = "light" | "dark";

export const PLATFORM_MODE_KEY = "platform-color-mode";

export function readPlatformMode(): PlatformMode {
    try {
        return window.localStorage.getItem(PLATFORM_MODE_KEY) === "dark" ? "dark" : "light";
    } catch {
        return "light";
    }
}

export function applyPlatformMode(mode: PlatformMode) {
    document.documentElement.setAttribute("data-platform-mode", mode);
    try {
        window.localStorage.setItem(PLATFORM_MODE_KEY, mode);
    } catch {
        /* private browsing can block storage; the attribute still applies */
    }
}

export function applyPlatformFavicon(href: string) {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'));
    const link = links[0] ?? document.head.appendChild(document.createElement("link"));
    link.rel = "icon";
    link.type = "image/x-icon";
    link.href = href;
    links.slice(1).forEach(extra => extra.remove());
}
