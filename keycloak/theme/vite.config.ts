import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { keycloakify } from "keycloakify/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        keycloakify({
            themeName: "platform",
            accountThemeImplementation: "Single-Page",
            keycloakVersionTargets: {
                "22-to-25": false,
                "all-other-versions": "platform-theme.jar"
            },
            postBuild: async () => {
                const { cp, mkdir } = await import("node:fs/promises");
                const { dirname, join } = await import("node:path");
                const { fileURLToPath } = await import("node:url");
                const projectDir = dirname(fileURLToPath(import.meta.url));
                const assets = join(projectDir, "src", "assets");
                const tokens = join(projectDir, "src", "theme", "tokens.css");
                const welcomeDest = join(process.cwd(), "theme", "platform", "welcome");
                await mkdir(join(welcomeDest, "resources", "css"), { recursive: true });
                await cp(join(projectDir, "welcome"), welcomeDest, { recursive: true });
                for (const file of [
                    "favicon-light.ico",
                    "favicon-dark.ico",
                    "logo-light.png",
                    "logo-dark.png"
                ]) {
                    await cp(join(assets, file), join(welcomeDest, "resources", file));
                }
                await cp(tokens, join(welcomeDest, "resources", "css", "tokens.css"));
                const emailRes = join(
                    process.cwd(),
                    "theme",
                    "platform",
                    "email",
                    "resources"
                );
                await mkdir(emailRes, { recursive: true });
                await cp(
                    join(assets, "logo-light.png"),
                    join(emailRes, "logo-light.png")
                );
            }
        })
    ]
});
