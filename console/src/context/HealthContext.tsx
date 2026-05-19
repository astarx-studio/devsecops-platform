'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { checkHealth } from '@/lib/client';

interface HealthContextValue {
  healthStatus: string | null;
  refreshHealth: () => Promise<void>;
}

const HealthContext = createContext<HealthContextValue | null>(null);

export function HealthProvider({ children }: { children: ReactNode }) {
  const [healthStatus, setHealthStatus] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await checkHealth();
      setHealthStatus(`${h.status} (mongo=${h.mongo ?? '?'}, vault=${h.vault ?? '?'})`);
    } catch (err) {
      setHealthStatus(`unreachable: ${(err as Error).message}`);
    }
  }, []);

  const value = useMemo<HealthContextValue>(
    () => ({ healthStatus, refreshHealth }),
    [healthStatus, refreshHealth],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthContextValue {
  const ctx = useContext(HealthContext);
  if (!ctx) {
    throw new Error('useHealth must be used within HealthProvider');
  }
  return ctx;
}
