import { McpAccessKeyService, hashToken } from './mcp-access-key.service';

describe('McpAccessKeyService', () => {
  const rows: Array<Record<string, unknown> & { save: () => Promise<void> }> = [];

  const keyModel = {
    create: jest.fn(async (doc: Record<string, unknown>) => {
      const row = {
        ...doc,
        _id: `id-${rows.length + 1}`,
        createdAt: new Date('2026-10-13T00:00:00.000Z'),
        save: jest.fn(async () => undefined),
      };
      rows.push(row);
      return row;
    }),
    countDocuments: jest.fn(() => ({
      exec: async () => rows.filter((row) => !row.revokedAt).length,
    })),
    find: jest.fn(() => ({
      sort: () => ({
        exec: async () => rows.filter((row) => !row.revokedAt),
      }),
    })),
    findOne: jest.fn((query: { tokenHash: string }) => ({
      exec: async () => rows.find((row) => row.tokenHash === query.tokenHash) ?? null,
    })),
    findById: jest.fn((id: string) => ({
      exec: async () => rows.find((row) => row._id === id) ?? null,
    })),
  };

  const auditLogModel = { create: jest.fn(async () => ({})) };

  const service = new McpAccessKeyService(keyModel as never, auditLogModel as never);

  beforeEach(() => {
    rows.length = 0;
    jest.clearAllMocks();
  });

  it('stores only a hash and authenticates the raw token once', async () => {
    const created = await service.create('Cursor laptop');

    expect(created.scope).toBe('read');
    expect(created.token.startsWith('dsoas_')).toBe(true);
    expect(created.tokenPrefix.length).toBeGreaterThan('dsoas_'.length);
    expect(rows[0]?.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(rows[0])).not.toContain(created.token);
    expect(auditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'mcp.key.created' }),
    );

    const authed = await service.authenticate(created.token);
    expect(authed?.tokenPrefix).toBe(created.tokenPrefix);
    expect(await service.authenticate('change-me-management-api-key')).toBeNull();
  });

  it('rejects a revoked token', async () => {
    const created = await service.create('CI reader');
    await service.revoke(created.id);
    expect(await service.authenticate(created.token)).toBeNull();
    expect(auditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'mcp.key.revoked' }),
    );
  });
});
