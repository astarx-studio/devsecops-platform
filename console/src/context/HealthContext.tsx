"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { checkHealth } from "@/lib/client";

export interface HealthSnapshot {
  status: string;
  mongo?: string;
  vault?: string;
  checks?: string;
  notChecked?: string;
}

interface HealthContextValue {
  healthStatus: string | null;
  health: HealthSnapshot | null;
  refreshing: boolean;
  refreshHealth: () => Promise<void>;
}

const HealthContext = createContext<HealthContextValue | null>(null);

export function HealthProvider({ children }: { children: ReactNode }) {
  const [healthStatus, setHealthStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshHealth = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await checkHealth();
      const notChecked = result.notChecked ?? "gitlab, kubernetes, keycloak, sonarqube";
      setHealth({ ...result, notChecked });
      setHealthStatus(
        `${result.status} (mongo=${result.mongo ?? "?"}, vault=${result.vault ?? "?"}) — not checked: ${notChecked}`,
      );
    } catch (err) {
      setHealth(null);
      setHealthStatus(`unreachable: ${(err as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const value = useMemo<HealthContextValue>(
    () => ({ healthStatus, health, refreshing, refreshHealth }),
    [healthStatus, health, refreshing, refreshHealth],
  );

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthContextValue {
  const ctx = useContext(HealthContext);
  if (!ctx) {
    throw new Error("useHealth must be used within HealthProvider");
  }
  return ctx;
}
