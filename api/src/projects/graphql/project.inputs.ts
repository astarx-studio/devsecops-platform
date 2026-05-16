import GraphQLJSON from 'graphql-type-json';

import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { Provisioning, SonarGateMode } from './enums';

/** Slug validation pattern: lowercase alphanumeric with internal hyphens. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const SLUG_MESSAGE =
  'must be lowercase alphanumeric with optional internal hyphens (no leading/trailing hyphens)';

/**
 * Capability input — deployable flag.
 * When set to true, the project receives an Ingress, Helm release, and
 * app hostname in each environment.
 */
@InputType({ description: 'Capability configuration for a deployable HTTP application.' })
export class CapabilitiesInput {
  @Field(() => Boolean, { defaultValue: true, description: 'Deploy as an HTTP application.' })
  @IsBoolean()
  @IsOptional()
  deployable?: boolean = true;

  @Field(() => Boolean, { defaultValue: false, description: 'Publish as a package.' })
  @IsBoolean()
  @IsOptional()
  publishable?: boolean = false;
}

/**
 * Per-environment JSON variable overrides.
 * Each env field is a JSON string of arbitrary key-value pairs that is merged with
 * the default Vault secret seed for that environment (projects/{path}/{env}).
 */
@InputType({ description: 'Environment-specific CI/CD variable overrides.' })
export class EnvScopedVarsInput {
  @Field(() => String, {
    nullable: true,
    description: 'JSON string of dev-environment variable overrides.',
  })
  @IsString()
  @IsOptional()
  dev?: string;

  @Field(() => String, {
    nullable: true,
    description: 'JSON string of stg-environment variable overrides.',
  })
  @IsString()
  @IsOptional()
  stg?: string;

  @Field(() => String, {
    nullable: true,
    description: 'JSON string of prod-environment variable overrides.',
  })
  @IsString()
  @IsOptional()
  prod?: string;
}

@InputType({ description: 'Per-tier Sonar quality gate overrides.' })
export class SonarGatePolicyInput {
  @Field(() => SonarGateMode, { nullable: true })
  @IsEnum(SonarGateMode)
  @IsOptional()
  dev?: SonarGateMode;

  @Field(() => SonarGateMode, { nullable: true })
  @IsEnum(SonarGateMode)
  @IsOptional()
  stg?: SonarGateMode;

  @Field(() => SonarGateMode, { nullable: true })
  @IsEnum(SonarGateMode)
  @IsOptional()
  prod?: SonarGateMode;

  @Field(() => SonarGateMode, { nullable: true })
  @IsEnum(SonarGateMode)
  @IsOptional()
  other?: SonarGateMode;
}

@InputType({ description: 'SonarQube branch allowlist and optional gate policy.' })
export class UpdateProjectSonarConfigInput {
  @Field(() => [String], {
    description:
      'Branch names that run Sonar (e.g. develop, staging, main). Empty array disables Sonar.',
  })
  @IsArray()
  @IsString({ each: true })
  allowedBranches!: string[];

  @Field(() => SonarGatePolicyInput, {
    nullable: true,
    description: 'Per-tier gate policy. Defaults: dev optional, stg/prod required, other optional.',
  })
  @ValidateNested()
  @Type(() => SonarGatePolicyInput)
  @IsOptional()
  gatePolicy?: SonarGatePolicyInput;

  @Field(() => String, {
    nullable: true,
    description: 'Sonar analysis token. Stored in Vault and mirrored to GitLab SONAR_TOKEN.',
  })
  @IsString()
  @IsOptional()
  sonarToken?: string;
}

/**
 * Input type for the `createProject` mutation.
 *
 * Defines all parameters needed to provision a project end-to-end:
 * GitLab group hierarchy, slug, provisioning strategy, capabilities,
 * and optional Vault seed variables.
 */
@InputType({ description: 'Parameters for provisioning a new platform project.' })
export class CreateProjectInput {
  @Field(() => [String], {
    description:
      'Ordered group path from root to parent, e.g. ["groupa", "groupab", "projecta", "componentab"]. ' +
      'The leaf segment is the projectSlug — do not include it here.',
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  groupPath!: string[];

  @Field(() => String, {
    description:
      'Leaf project identifier (lowercase, hyphens allowed). Becomes the GitLab project slug.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(63)
  @Matches(SLUG_PATTERN, { message: `projectSlug ${SLUG_MESSAGE}` })
  projectSlug!: string;

  @Field(() => String, { nullable: true, description: 'Optional human-readable display name.' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @Field(() => Provisioning, {
    defaultValue: Provisioning.AUTO_DEVOPS,
    description: 'Provisioning strategy (defaults to AUTO_DEVOPS).',
  })
  @IsEnum(Provisioning)
  @IsOptional()
  provisioning?: Provisioning = Provisioning.AUTO_DEVOPS;

  @Field(() => String, {
    nullable: true,
    description: 'Template slug to fork when provisioning === TEMPLATE.',
  })
  @IsString()
  @IsOptional()
  templateSlug?: string;

  @Field(() => CapabilitiesInput, {
    nullable: true,
    description: 'Capability flags (defaults to deployable=true, publishable=false).',
  })
  @ValidateNested()
  @Type(() => CapabilitiesInput)
  @IsOptional()
  capabilities?: CapabilitiesInput;

  /**
   * Base Vault secret seed for all environments.
   * Accepts a JSON object (e.g. { "MY_KEY": "value" }).
   * Validated by the GraphQL gateway — no manual JSON.parse required.
   */
  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Key-value object seeded into Vault for all environments.',
  })
  @IsObject()
  @IsOptional()
  envVars?: Record<string, string>;

  @Field(() => EnvScopedVarsInput, {
    nullable: true,
    description: 'Per-environment variable overrides (JSON strings keyed by env scope).',
  })
  @ValidateNested()
  @Type(() => EnvScopedVarsInput)
  @IsOptional()
  envScopedVars?: EnvScopedVarsInput;

  /**
   * Explicit effective slug override — bypasses auto-generation and collision-suffix.
   * Must be globally unique; throws ConflictException if already taken.
   */
  @Field(() => String, {
    nullable: true,
    description:
      'Explicit effective slug override (bypasses auto-generation and collision-suffix). ' +
      'Must be globally unique.',
  })
  @IsString()
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: `slugOverride ${SLUG_MESSAGE}` })
  slugOverride?: string;

  @Field(() => UpdateProjectSonarConfigInput, {
    nullable: true,
    description: 'Optional Sonar opt-in at provision time (explicit only).',
  })
  @ValidateNested()
  @Type(() => UpdateProjectSonarConfigInput)
  @IsOptional()
  sonar?: UpdateProjectSonarConfigInput;
}

/**
 * Input type for filtering the `projects` query.
 */
@InputType({ description: 'Filter criteria for the projects query.' })
export class ProjectFilterInput {
  @Field(() => [String], {
    nullable: true,
    description: 'Return only projects whose groupPath starts with these segments.',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  groupPathPrefix?: string[];

  @Field(() => Boolean, {
    nullable: true,
    description: 'Filter by legacyV1 flag.',
  })
  @IsBoolean()
  @IsOptional()
  legacyV1?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Filter by pinnedV1 flag.',
  })
  @IsBoolean()
  @IsOptional()
  pinnedV1?: boolean;
}
