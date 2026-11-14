import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import type { HydratedDocument } from 'mongoose';

import { auditActorAls } from '../../common/audit/audit-actor.context';

export type AuditEventType =
  | 'project.created'
  | 'project.deleted'
  | 'project.archived'
  | 'project.migrated'
  | 'project.hostname_override'
  | 'project.pinned_v1'
  | 'project.reconciled_legacy'
  | 'project.sonar_config_updated'
  | 'project.sonar_provisioned'
  | 'project.sonar_deleted'
  | 'project.registered'
  | 'project.deployment.upserted'
  | 'project.deployment.removed'
  | 'env.profile.revealed'
  | 'env.profile.content_updated'
  | 'env.profile.metadata_updated'
  | 'mcp.key.created'
  | 'mcp.key.revoked'
  | 'app.logs.read';

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
      'project.archived',
      'project.migrated',
      'project.hostname_override',
      'project.pinned_v1',
      'project.reconciled_legacy',
      'project.sonar_config_updated',
      'project.sonar_provisioned',
      'project.sonar_deleted',
      'project.registered',
      'project.deployment.upserted',
      'project.deployment.removed',
      'env.profile.revealed',
      'env.profile.content_updated',
      'env.profile.metadata_updated',
      'mcp.key.created',
      'mcp.key.revoked',
      'app.logs.read',
    ]),
  })
  eventType!: AuditEventType;

  /** Caller identity: `api-key` or `oidc:<username>`. Empty when unknown. */
  @Prop()
  actor?: string;

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
   * `project.hostname_override`; `{ reason: 'manual GitLab detection' }` for
   * `project.reconciled_legacy`.
   */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  /** Managed by `timestamps: true`. */
  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.pre('validate', function stampActor() {
  const actor = auditActorAls.getStore()?.actor;
  if (actor && !this.actor) {
    this.actor = actor;
  }
});
