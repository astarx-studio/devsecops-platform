import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";

import { ThemeRegistry } from "@/components/ThemeRegistry";
import { HealthProvider } from "@/context/HealthContext";

export const metadata: Metadata = {
  title: "DSOaaS Control Plane",
  description: "Enterprise operations console for the DSOaaS DevSecOps platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          <HealthProvider>{children}</HealthProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
