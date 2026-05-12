import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import type { HydratedDocument } from 'mongoose';

export type AuditEventType =
  | 'project.created'
  | 'project.deleted'
  | 'project.migrated'
  | 'project.hostname_override'
  | 'project.pinned_v1'
  | 'project.reconciled_legacy';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * Immutable audit trail for project provisioning and lifecycle events.
 *
 * Stored in a capped MongoDB collection (100 MB) to bound growth while
 * retaining recent operational history. All writes are append-only.
 *
 * `timestamps: true` adds `createdAt` which serves as the event timestamp.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'audit_logs',
  capped: { size: 100 * 1024 * 1024 },
})
export class AuditLog {
  /** Type of lifecycle event that occurred. */
  @Prop({
    required: true,
    enum: Object.values([
      'project.created',
      'project.deleted',
      'project.migrated',
      'project.hostname_override',
      'project.pinned_v1',
      'project.reconciled_legacy',
    ]),
  })
  eventType!: AuditEventType;

  /** MongoDB ObjectId of the affected project document (as string). */
  @Prop()
  projectId?: string;

  /** GitLab `path_with_namespace` at the time of the event. */
  @Prop()
  gitlabPath?: string;

  /** Effective slug at the time of the event. */
  @Prop()
  effectiveSlug?: string;

  /**
   * Freeform metadata specific to the event type.
   * Examples: `{ env: 'dev', hostname: 'foo.dev.apps.example.com' }` for
   * `project.hostname_override`; `{ reason: 'startup reconciliation' }` for
   * `project.reconciled_legacy`.
   */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  /** Managed by `timestamps: true`. */
  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
