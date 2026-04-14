import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Request body for creating a new shared CI/CD config repository.
 *
 * Config repos live in the GitLab "configs" group and contain reusable
 * hidden CI job definitions that apps include via `include: project:`.
 *
 * @property slug - URL-safe identifier (e.g. "node-pipeline"). Becomes the GitLab project path.
 * @property description - Human-readable description of what this config provides.
 * @property ciContent - Initial `.gitlab-ci.yml` content with hidden job definitions.
 */
export class CreateConfigDto {
  @ApiProperty({
    example: 'node-pipeline',
    description: 'URL-safe identifier for the config repo (lowercase, hyphens allowed)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message:
      'slug must be lowercase alphanumeric with optional hyphens (no leading/trailing hyphens)',
  })
  slug!: string;

  @ApiPropertyOptional({
    example: 'Reusable CI/CD stages for Node.js projects (lint, test, build)',
    description: 'Human-readable description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example:
      '.lint:\n  stage: lint\n  image: node:20-alpine\n  script:\n    - pnpm install --frozen-lockfile\n    - pnpm run lint\n',
    description: 'Initial .gitlab-ci.yml content with hidden job definitions',
  })
  @IsString()
  @IsNotEmpty()
  ciContent!: string;
}
