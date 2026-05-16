import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { Provisioning, SonarGateMode } from './enums';

/**
 * GraphQL ObjectType: per-environment hostname map.
 * All fields are nullable since not every environment may be active.
 */
@ObjectType({ description: 'Application hostnames per deployment environment.' })
export class AppHostsType {
  @Field(() => String, { nullable: true, description: 'Development environment hostname.' })
  dev?: string;

  @Field(() => String, { nullable: true, description: 'Staging environment hostname.' })
  stg?: string;

  @Field(() => String, { nullable: true, description: 'Production environment hostname.' })
  prod?: string;
}

/**
 * GraphQL ObjectType: project capability flags.
 */
@ObjectType({ description: 'Capability flags set at project provisioning time.' })
export class CapabilitiesType {
  @Field(() => Boolean, {
    description: 'Project runs as an HTTP app (has Ingress + Helm release).',
  })
  deployable!: boolean;

  @Field(() => Boolean, { description: 'Project produces a distributable package.' })
  publishable!: boolean;
}

@ObjectType({ description: 'Per-tier Sonar quality gate enforcement when analysis runs.' })
export class SonarGatePolicyType {
  @Field(() => SonarGateMode)
  dev!: SonarGateMode;

  @Field(() => SonarGateMode)
  stg!: SonarGateMode;

  @Field(() => SonarGateMode)
  prod!: SonarGateMode;

  @Field(() => SonarGateMode, { nullable: true })
  other?: SonarGateMode;
}

@ObjectType({ description: 'SonarQube opt-in configuration for a project.' })
export class ProjectSonarType {
  @Field(() => [String], {
    description: 'Git branch names that run Sonar analysis. Empty means disabled.',
  })
  allowedBranches!: string[];

  @Field(() => SonarGatePolicyType, {
    description: 'Quality gate policy per deploy tier (derived from DEPLOY_*_REF in CI).',
  })
  gatePolicy!: SonarGatePolicyType;

  @Field(() => String, {
    nullable: true,
    description: 'Public Sonar dashboard URL pattern for this project (when enabled).',
  })
  dashboardUrl?: string;
}

/**
 * GraphQL ObjectType: a platform project.
 *
 * Mirrors the MongoDB Project document; the `id` field resolves to the
 * Mongoose `_id` (ObjectId as string).
 */
@ObjectType({ description: 'A project provisioned through the DSOaaS platform.' })
export class ProjectType {
  @Field(() => ID, { description: 'MongoDB document ID.' })
  id!: string;

  @Field(() => Int, { description: 'GitLab numeric project ID.' })
  gitlabProjectId!: number;

  @Field(() => String, { description: 'Full GitLab path (e.g. "groupa/groupab/repoa").' })
  gitlabPath!: string;

  @Field(() => [String], {
    description: 'Ordered group path segments from root to leaf, excluding the project slug.',
  })
  groupPath!: string[];

  @Field(() => String, { description: 'User-supplied leaf slug (before collision resolution).' })
  projectSlug!: string;

  @Field(() => String, {
    description:
      'Resolved slug used as Helm release name and hostname prefix. ' +
      'Equals projectSlug unless a collision forced a 4-hex SHA1 suffix.',
  })
  effectiveSlug!: string;

  @Field(() => String, { nullable: true, description: 'Optional human-readable display name.' })
  displayName?: string;

  @Field(() => Provisioning, { description: 'How the project was initially provisioned.' })
  provisioning!: Provisioning;

  @Field(() => String, {
    nullable: true,
    description: 'Template slug used when provisioning === TEMPLATE.',
  })
  templateSlug?: string;

  @Field(() => String, {
    description: "Vault KV v2 base path for this project's secrets.",
  })
  vaultBasePath!: string;

  @Field(() => String, {
    description: 'Helm release name in each k3d namespace — always equals effectiveSlug.',
  })
  helmReleaseName!: string;

  @Field(() => AppHostsType, { description: 'Computed application hostnames per environment.' })
  appHosts!: AppHostsType;

  @Field(() => CapabilitiesType, { description: 'Capability flags.' })
  capabilities!: CapabilitiesType;

  @Field(() => ProjectSonarType, {
    nullable: true,
    description: 'SonarQube opt-in config. Null when Sonar is disabled.',
  })
  sonar?: ProjectSonarType;

  @Field(() => Boolean, {
    description: 'True for projects still on the v1 Docker Compose stack.',
  })
  legacyV1!: boolean;

  @Field(() => Boolean, {
    description: 'True for legacy projects explicitly pinned to remain on v1.',
  })
  pinnedV1!: boolean;

  @Field(() => Date, { description: 'Provisioning timestamp.' })
  createdAt!: Date;

  @Field(() => Date, { description: 'Last modification timestamp.' })
  updatedAt!: Date;
}

/**
 * GraphQL ObjectType: template catalog entry (backed by GitLab templates group).
 */
@ObjectType({ description: 'A project template available for forking.' })
export class TemplateType {
  @Field(() => Int, { description: 'GitLab project ID.' })
  id!: number;

  @Field(() => String, { description: 'URL-safe template identifier.' })
  slug!: string;

  @Field(() => String, { nullable: true, description: 'Human-readable description.' })
  description?: string | null;

  @Field(() => String, { description: 'GitLab web URL.' })
  gitlabUrl!: string;

  @Field(() => String, { nullable: true, description: 'Default branch name.' })
  defaultBranch?: string;
}

/**
 * GraphQL ObjectType: shared CI/CD config catalog entry (backed by GitLab configs group).
 */
@ObjectType({ description: 'A shared CI/CD config repository.' })
export class ConfigType {
  @Field(() => Int, { description: 'GitLab project ID.' })
  id!: number;

  @Field(() => String, { description: 'URL-safe config identifier.' })
  slug!: string;

  @Field(() => String, { nullable: true, description: 'Human-readable description.' })
  description?: string | null;

  @Field(() => String, { description: 'GitLab web URL.' })
  gitlabUrl!: string;
}
