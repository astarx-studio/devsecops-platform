import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Configuration for a deployable project capability.
 *
 * When present, the project is treated as a runnable HTTP application
 * and receives a subdomain, Kong route, and deployment pipeline.
 *
 * @property domain - Custom domain override. Auto-generated as "{projectName}.apps.{DOMAIN}" if omitted.
 * @property autoDeploy - Whether to trigger the CI pipeline automatically after creation (defaults to true).
 */
export class DeployableCapability {
  @ApiPropertyOptional({
    example: 'webapp.apps.yourdomain.com',
    description: 'Custom domain. Auto-generated as {projectName}.apps.{DOMAIN} if omitted.',
  })
  @IsString()
  @IsOptional()
  domain?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Trigger CI pipeline after project creation (defaults to true)',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  autoDeploy?: boolean;
}

/**
 * Configuration for a publishable project capability.
 *
 * When present, the project produces a distributable package and
 * the CI config includes a publish stage.
 *
 * @property packageName - Custom package name override. Auto-generated as "@{clientName}/{projectName}" if omitted.
 */
export class PublishableCapability {
  @ApiPropertyOptional({
    example: '@acme/shared-utils',
    description: 'Custom package name. Auto-generated as @{clientName}/{projectName} if omitted.',
  })
  @IsString()
  @IsOptional()
  packageName?: string;
}

/**
 * Compositional capabilities for a project.
 *
 * A project can have any combination of capabilities:
 * - deployable: HTTP application with a domain
 * - publishable: distributable package
 * - both: e.g. a UI library with Storybook deployment
 * - neither: a plain repository
 *
 * @property deployable - If present, project gets a domain and Kong route
 * @property publishable - If present, project gets package publishing config
 */
export class ProjectCapabilities {
  @ApiPropertyOptional({
    description: 'Deploy as an HTTP application with a subdomain',
    type: DeployableCapability,
  })
  @ValidateNested()
  @Type(() => DeployableCapability)
  @IsOptional()
  deployable?: DeployableCapability;

  @ApiPropertyOptional({
    description: 'Publish as a distributable package',
    type: PublishableCapability,
  })
  @ValidateNested()
  @Type(() => PublishableCapability)
  @IsOptional()
  publishable?: PublishableCapability;
}
