import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeRegistry } from '@/components/ThemeRegistry';
import { HealthProvider } from '@/context/HealthContext';

export const metadata: Metadata = {
  title: 'DSOaaS Management Console',
  description: 'Operator console for the DevSecOps platform Management API',
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
