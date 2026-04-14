import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

import { ProjectCapabilities } from './capabilities.dto';

/**
 * Request body for creating a new project.
 *
 * Orchestrates GitLab fork, config injection, capability-based provisioning
 * (domain/Kong for deployable, package config for publishable), Vault secret
 * seeding, and optional Cloudflare DNS creation.
 *
 * @property clientName - Client identifier (lowercase, hyphens). Used in group path, Vault path, subdomain.
 * @property projectName - Project identifier (lowercase, hyphens). Used in GitLab project, Vault path, subdomain.
 * @property templateSlug - Name of the template project to fork (must exist in the template group).
 * @property capabilities - Compositional capabilities: deployable (domain), publishable (package), both, or neither.
 * @property configs - Slugs of config repos to inject as GitLab CI `include:` directives.
 * @property description - Human-readable project description passed to GitLab.
 * @property envVars - Additional environment variables seeded into Vault alongside template defaults.
 * @property groupPath - GitLab group hierarchy. Defaults to ["clients", "{clientName}"].
 */
export class CreateProjectDto {
  @ApiProperty({
    example: 'acme',
    description: 'Client/organization identifier (lowercase, hyphens allowed)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message:
      'clientName must be lowercase alphanumeric with optional hyphens (no leading/trailing hyphens)',
  })
  clientName!: string;

  @ApiProperty({
    example: 'webapp',
    description: 'Project identifier (lowercase, hyphens allowed)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message:
      'projectName must be lowercase alphanumeric with optional hyphens (no leading/trailing hyphens)',
  })
  projectName!: string;

  @ApiProperty({
    example: 'nestjs-app',
    description: 'Template slug to fork from the template group',
  })
  @IsString()
  @IsNotEmpty()
  templateSlug!: string;

  @ApiPropertyOptional({
    description:
      'Compositional capabilities. Omit for a plain repository with no domain or package.',
    type: ProjectCapabilities,
  })
  @ValidateNested()
  @Type(() => ProjectCapabilities)
  @IsOptional()
  capabilities?: ProjectCapabilities;

  @ApiPropertyOptional({
    example: ['node-pipeline', 'docker-pipeline'],
    description:
      'Config repo slugs to inject as GitLab CI include directives (in addition to template defaults)',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  configs?: string[];

  @ApiPropertyOptional({
    example: 'ACME Corp main web application',
    description: 'Human-readable project description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: { DATABASE_URL: 'postgresql://...', JWT_SECRET: 'my-secret' },
    description: 'Additional env vars seeded into Vault',
  })
  @IsOptional()
  envVars?: Record<string, string>;

  @ApiPropertyOptional({
    example: ['clients', 'acme'],
    description: 'GitLab group hierarchy. Defaults to ["clients", "{clientName}"]',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  groupPath?: string[];
}
