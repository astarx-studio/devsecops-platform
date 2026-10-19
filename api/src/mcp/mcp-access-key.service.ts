import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AuditLog } from '../projects/schemas/audit-log.schema';
import { McpAccessKey, McpAccessKeyDocument } from './mcp-access-key.schema';
import { parseMcpScope, type McpScope } from './mcp-scopes';

const TOKEN_PREFIX = 'dsoas_';
const MAX_ACTIVE_KEYS = 25;
const NAME_PATTERN = /^[\w .()-]{1,64}$/;

export interface McpAccessKeyView {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: McpScope;
  createdAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreatedMcpAccessKey extends McpAccessKeyView {
  /** Present only on the create response. */
  token: string;
}

export interface AuthenticatedMcpKey {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: McpScope;
}

@Injectable()
export class McpAccessKeyService {
  constructor(
    @InjectModel(McpAccessKey.name)
    private readonly keyModel: Model<McpAccessKeyDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
  ) {}

  async create(name: string, scopeInput: unknown = 'read'): Promise<CreatedMcpAccessKey> {
    const trimmed = name.trim();
    if (!NAME_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        'Name must be 1–64 characters: letters, numbers, spaces, and ._-()',
      );
    }
    let scope: McpScope;
    try {
      scope = parseMcpScope(scopeInput);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const active = await this.keyModel.countDocuments({ revokedAt: { $exists: false } }).exec();
    if (active >= MAX_ACTIVE_KEYS) {
      throw new BadRequestException(
        `At most ${MAX_ACTIVE_KEYS} active MCP keys. Revoke one before creating another.`,
      );
    }

    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const doc = await this.keyModel.create({
      name: trimmed,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 8),
      scope,
    });

    await this.auditLogModel.create({
      eventType: 'mcp.key.created',
      metadata: { name: doc.name, tokenPrefix: doc.tokenPrefix, scope },
    });

    return { ...toView(doc), token };
  }

  async list(includeRevoked = false): Promise<McpAccessKeyView[]> {
    const filter = includeRevoked ? {} : { revokedAt: { $exists: false } };
    const rows = await this.keyModel.find(filter).sort({ createdAt: -1 }).exec();
    return rows.map(toView);
  }

  async revoke(id: string): Promise<boolean> {
    let doc: McpAccessKeyDocument | null;
    try {
      doc = await this.keyModel.findById(id).exec();
    } catch {
      throw new NotFoundException('MCP access key not found');
    }
    if (!doc) {
      throw new NotFoundException('MCP access key not found');
    }
    if (!doc.revokedAt) {
      doc.revokedAt = new Date();
      if (!doc.scope) {
        doc.scope = 'read';
      }
      await doc.save();
      await this.auditLogModel.create({
        eventType: 'mcp.key.revoked',
        metadata: { name: doc.name, tokenPrefix: doc.tokenPrefix },
      });
    }
    return true;
  }

  /**
   * Resolves a raw bearer token to an active key.
   * The platform API_KEY is not accepted here.
   */
  async authenticate(token: string): Promise<AuthenticatedMcpKey | null> {
    const trimmed = token.trim();
    if (!trimmed.startsWith(TOKEN_PREFIX)) {
      return null;
    }
    const doc = await this.keyModel.findOne({ tokenHash: hashToken(trimmed) }).exec();
    if (!doc || doc.revokedAt) {
      return null;
    }
    doc.lastUsedAt = new Date();
    if (!doc.scope) {
      doc.scope = 'read';
    }
    await doc.save();
    return {
      id: String(doc._id),
      name: doc.name,
      tokenPrefix: doc.tokenPrefix,
      scope: doc.scope ?? 'read',
    };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toView(doc: McpAccessKeyDocument): McpAccessKeyView {
  return {
    id: String(doc._id),
    name: doc.name,
    tokenPrefix: doc.tokenPrefix,
    scope: doc.scope ?? 'read',
    createdAt: doc.createdAt?.toISOString(),
    lastUsedAt: doc.lastUsedAt?.toISOString(),
    revokedAt: doc.revokedAt?.toISOString(),
  };
}
