/** Higher scopes include every tool of the scopes below them. */
export const MCP_SCOPES = ['read', 'read_secret', 'operate', 'full'] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

const RANK: Record<McpScope, number> = {
  read: 1,
  read_secret: 2,
  operate: 3,
  full: 4,
};

export const MCP_SCOPE_LABEL: Record<McpScope, string> = {
  read: 'Read',
  read_secret: 'Read secrets',
  operate: 'Limited read/write',
  full: 'Full access',
};

export function parseMcpScope(value: unknown): McpScope {
  if (typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value)) {
    return value as McpScope;
  }
  throw new Error('scope must be read, read_secret, operate, or full');
}

export function scopeAllows(granted: McpScope, required: McpScope): boolean {
  return RANK[granted] >= RANK[required];
}

export function scopeInstructions(scope: McpScope): string {
  switch (scope) {
    case 'read':
      return 'This key can read project metadata, templates, shared CI configs, health, and audit logs. Secret values are not available.';
    case 'read_secret':
      return 'This key can read project metadata and env profile secret values. It cannot change the platform.';
    case 'operate':
      return 'This key can read secrets and perform non-destructive writes: create and register projects, targets, env profiles, Sonar provision, templates, and shared CI configs. It cannot delete or tear down.';
    case 'full':
      return 'This key can perform every DSOaaS project, template, and config operation, including delete and teardown. It cannot issue MCP keys.';
  }
}
