import type { ClusterProfile } from '@/lib/types';

/** GraphQL ClusterProfile enum member names (wire format for mutations). */
export const CLUSTER_PROFILE_OPTIONS: readonly ClusterProfile[] = ['DEV', 'STG', 'PROD'] as const;

/** Normalizes API/form values to GraphQL enum keys (DEV | STG | PROD). */
export function normalizeClusterProfile(value: string | undefined): ClusterProfile {
  const upper = (value ?? 'PROD').toUpperCase();
  if (upper === 'DEV' || upper === 'STG' || upper === 'PROD') {
    return upper;
  }
  return 'PROD';
}

/** Human-readable label for tables (dev, stg, prod). */
export function clusterProfileLabel(value: string): string {
  return normalizeClusterProfile(value).toLowerCase();
}
