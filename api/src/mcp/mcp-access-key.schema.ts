import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import type { HydratedDocument } from 'mongoose';

import { MCP_SCOPES, type McpScope } from './mcp-scopes';

export type McpAccessKeyDocument = HydratedDocument<McpAccessKey>;

/**
 * Operator-issued credential for the DSOaaS MCP listener.
 * The raw token is returned once at creation and only its SHA-256 is stored.
 */
@Schema({ timestamps: true, collection: 'mcp_access_keys' })
export class McpAccessKey {
  @Prop({ required: true, trim: true, maxlength: 64 })
  name!: string;

  /** SHA-256 hex of the full token. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** Non-secret display prefix, for example `dsoas_ab12cd34`. */
  @Prop({ required: true })
  tokenPrefix!: string;

  /**
   * read < read_secret < operate < full.
   * Missing on older documents means read.
   */
  @Prop({ type: String, required: true, enum: MCP_SCOPES, default: 'read' })
  scope!: McpScope;

  @Prop()
  lastUsedAt?: Date;

  @Prop()
  revokedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const McpAccessKeySchema = SchemaFactory.createForClass(McpAccessKey);
