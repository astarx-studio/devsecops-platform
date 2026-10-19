export interface AuditLogRow {
  id: string;
  eventType: string;
  actor?: string | null;
  projectId?: string | null;
  gitlabPath?: string | null;
  effectiveSlug?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function formatAuditWhen(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatAuditMetadata(
  metadata?: Record<string, unknown> | null,
): string {
  if (!metadata) return "";
  const parts = Object.entries(metadata).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  return parts
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text}`;
    })
    .join(" · ");
}

export function auditEventLabel(eventType: string): string {
  return eventType.replaceAll(".", " · ").replaceAll("_", " ");
}
