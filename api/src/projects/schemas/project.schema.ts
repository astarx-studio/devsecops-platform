import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import type { HydratedDocument } from 'mongoose';

import type {
  EnvProfileBuildDelivery,
  EnvProfileInjectionPhase,
} from '../env/env-profile.constants';
import type { ProjectSonarConfig } from '../sonar/sonar.types';

/** Deployment environment identifiers (standard k3d namespaces). */
export type DeployEnv = 'dev' | 'stg' | 'prod';

/** Kubeconfig / cluster profile used to reach a target namespace. */
export type ClusterProfile = 'dev' | 'stg' | 'prod';

/**
 * One deployable surface for a project (hostname, namespace, branch ref, CI wiring).
 * Keys are not limited to dev/stg/prod — e.g. `prod-alt` is valid.
 */
export class DeploymentTarget {
  /** Unique target identifier (DNS label), e.g. dev, prod-alt. */
  key!: string;

  /** Kubernetes namespace for Helm releases (often equals key). */
  kubeNamespace!: string;

  /** Which kubeconfig file (dev|stg|prod) backs this target. */
  clusterProfile!: ClusterProfile;

  /** Ingress hostname for this target. */
  appHost!: string;

  /** Git branch that triggers deploy, or `none` when disabled. */
  deployRef!: string;

  /** When false, deploy ref should be `none` and CI must not schedule deploy. */
  enabled!: boolean;

  /** GitLab CI environment_scope for env-scoped variables (defaults to key). */
  gitlabEnvironment?: string;

  /** Optional Sonar tier mapping for custom targets. */
  sonarTier?: 'dev' | 'stg' | 'prod' | 'other';
}

/** Provisioning strategy for a project. */
export type ProvisioningStrategy = 'auto-devops' | 'template';

/**
 * Per-environment hostname map.
 * Populated during provisioning; may be partially filled if only some envs are active.
 */
export class AppHosts {
  dev?: string;
  stg?: string;
  prod?: string;
}

/**
 * Capabilities flags for a project.
 * - deployable: project runs as an HTTP application (has Ingress + Helm release)
 * - publishable: project produces a distributable package (GitLab Package Registry)
 */
export class Capabilities {
  deployable!: boolean;
  publishable!: boolean;
}

/**
 * Branch-scoped env/config upload metadata (secrets live in Vault only).
 */
export class EnvProfile {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true, enum: ['build', 'runtime'] })
  injectionPhase!: EnvProfileInjectionPhase;

  @Prop({ type: [String], required: true, default: [] })
  branches!: string[];

  @Prop({ type: [String], default: [] })
  deploymentTargetKeys?: string[];

  @Prop()
  jobSelector?: string;

  @Prop()
  workspacePath?: string;

  @Prop()
  filename?: string;

  @Prop({ enum: ['raw_file', 'dotenv_build_args'] })
  buildDelivery?: EnvProfileBuildDelivery;

  @Prop({ required: true })
  vaultPath!: string;

  @Prop()
  contentType?: string;

  @Prop({ type: [String], default: [] })
  keyNames!: string[];

  @Prop()
  updatedAt?: Date;
}

/**
 * Mongoose document type for the Project collection.
 * HydratedDocument adds Mongoose instance methods (save, remove, etc.)
 * and the `_id` field typed as ObjectId.
 */
export type ProjectDocument = HydratedDocument<Project>;

/**
 * Mongoose schema for the core project registry.
 *
 * Each record represents a GitLab project that was provisioned through
 * the platform. Unique indexes on `gitlabProjectId`, `gitlabPath`, and
 * `effectiveSlug` enforce referential integrity across the system.
 *
 * `timestamps: true` automatically manages `createdAt` and `updatedAt`.
 */
@Schema({ timestamps: true, collection: 'projects' })
export class Project {
  /** GitLab numeric project ID — stable identifier even if path changes. */
  @Prop({ required: true, unique: true })
  gitlabProjectId!: number;

  /**
   * Full GitLab project path (e.g. "groupa/groupab/repoa").
   * Mirrors `path_with_namespace` from the GitLab API.
   */
  @Prop({ required: true, unique: true })
  gitlabPath!: string;

  /**
   * Ordered array of group segments from root to leaf, excluding the project
   * slug itself (e.g. ["groupa", "groupab", "projecta", "componentab"]).
   */
  @Prop({ type: [String], required: true })
  groupPath!: string[];

  /** User-supplied leaf identifier before collision resolution. */
  @Prop({ required: true })
  projectSlug!: string;

  /**
   * Resolved slug used as Helm release name and hostname prefix.
   * Equals `projectSlug` unless there is a collision, in which case a
   * 4-hex SHA1 suffix is appended (e.g. "repoa-a1b2").
   */
  @Prop({ required: true, unique: true })
  effectiveSlug!: string;

  /** Optional human-readable display name (used in GitLab project name). */
  @Prop()
  displayName?: string;

  /** Whether the project was provisioned via Auto DevOps or a template fork. */
  @Prop({ required: true, enum: ['auto-devops', 'template'], default: 'auto-devops' })
  provisioning!: ProvisioningStrategy;

  /** Template slug used when `provisioning === 'template'`. */
  @Prop()
  templateSlug?: string;

  /**
   * Vault KV v2 base path for this project's secrets
   * (e.g. "projects/groupa/groupab/repoa").
   */
  @Prop({ required: true })
  vaultBasePath!: string;

  /**
   * Helm release name in each k3d namespace — always equals `effectiveSlug`.
   * Stored explicitly to allow future renaming without slug mutation.
   */
  @Prop({ required: true })
  helmReleaseName!: string;

  /**
   * Computed application hostnames per environment.
   * Populated at provisioning time; may be overridden via `hostnameOverrides`.
   */
  @Prop({ type: Object, default: {} })
  appHosts!: AppHosts;

  /**
   * Explicit hostname overrides per environment set via `setHostnameOverride`
   * mutation. When present for an env, supersedes the computed `appHosts` value.
   */
  @Prop({ type: Object, default: {} })
  hostnameOverrides!: Partial<AppHosts>;

  /** Capability flags set at provisioning time. */
  @Prop({ type: Object, required: true })
  capabilities!: Capabilities;

  /**
   * Named deployment targets (source of truth for deploy wiring).
   * When absent on read, derived from appHosts + capabilities.deployable.
   */
  @Prop({ type: [Object], default: [] })
  deploymentTargets!: DeploymentTarget[];

  /** Branch-scoped env profiles (Vault-backed; see envProfiles[].vaultPath). */
  @Prop({ type: [Object], default: [] })
  envProfiles!: EnvProfile[];

  /**
   * When false, Helm chart disables ExternalSecret / pod envFrom (static baked builds).
   */
  @Prop({ default: true })
  runtimeEnvEnabled!: boolean;

  /**
   * Optional SonarQube opt-in: branch allowlist and per-tier quality gate policy.
   * Empty or missing `allowedBranches` means Sonar is disabled for this project.
   */
  @Prop({ type: Object })
  sonar?: ProjectSonarConfig;

  /**
   * `true` for projects provisioned through the v1 Docker Compose path.
   * Set to `false` after a successful `migrateProjectToAutoDevops` mutation.
   */
  @Prop({ default: false })
  legacyV1!: boolean;

  /**
   * `true` for legacy projects that should remain on the v1 stack indefinitely
   * (e.g. projects that cannot be containerised). Excluded from Phase 5 migration.
   */
  @Prop({ default: false })
  pinnedV1!: boolean;

  /**
   * When true, platform resources were torn down but the GitLab project could not be
   * deleted (often due to container registry). The record remains for operator visibility.
   */
  @Prop({ default: false, index: true })
  archived!: boolean;

  /** When the project was archived in the platform registry. */
  @Prop()
  archivedAt?: Date;

  /** Machine-readable reason (e.g. gitlab_delete_failed). */
  @Prop()
  archiveReason?: string;

  /** Last GitLab delete error message when archived due to failed deletion. */
  @Prop()
  gitlabDeleteError?: string;

  /** Managed by `timestamps: true` — set on first insert. */
  createdAt?: Date;

  /** Managed by `timestamps: true` — updated on every save. */
  updatedAt?: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
