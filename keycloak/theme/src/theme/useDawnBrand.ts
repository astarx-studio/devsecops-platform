import { useEffect, useState } from "react";
import { applyPlatformFavicon } from "./colorMode";

export function useDawnBrand(assets: { lightLogo: string; darkLogo: string; lightIcon: string; darkIcon: string }) {
    const [dark, setDark] = useState(() => document.documentElement.classList.contains("pf-v5-theme-dark"));

    useEffect(() => {
        const isDark = () => {
            const mode = document.documentElement.getAttribute("data-platform-mode");
            if (mode === "dark" || mode === "light") {
                return mode === "dark";
            }
            return document.documentElement.classList.contains("pf-v5-theme-dark");
        };
        const sync = () => {
            const next = isDark();
            setDark(next);
            applyPlatformFavicon(next ? assets.darkIcon : assets.lightIcon);
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-platform-mode"] });
        return () => observer.disconnect();
    }, [assets.darkIcon, assets.lightIcon]);

    return dark ? assets.darkLogo : assets.lightLogo;
}
