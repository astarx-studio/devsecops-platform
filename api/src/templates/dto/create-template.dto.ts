import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Request body for creating a new template repository.
 *
 * Templates live in the GitLab "templates" group and serve as starting
 * points for new projects. They can be created with inline files or
 * initialized as empty repos to be populated later.
 *
 * @property slug - URL-safe identifier (e.g. "nestjs-app"). Becomes the GitLab project path.
 * @property description - Human-readable description of the template's purpose and contents.
 * @property files - Optional map of file paths to content for initial population.
 */
export class CreateTemplateDto {
  @ApiProperty({
    example: 'nestjs-app',
    description: 'URL-safe identifier for the template (lowercase, hyphens allowed)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message:
      'slug must be lowercase alphanumeric with optional hyphens (no leading/trailing hyphens)',
  })
  slug!: string;

  @ApiPropertyOptional({
    example: 'Production-ready NestJS starter with Docker, CI/CD, and health checks',
    description: 'Human-readable template description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: {
      '.gitlab-ci.yml':
        'include:\n  - project: "configs/node-pipeline"\n    file: "/.gitlab-ci.yml"\n',
      Dockerfile: 'FROM node:20-alpine\nWORKDIR /app\n',
    },
    description:
      'Map of file paths to content. If omitted, the repo is initialized with just a README.',
  })
  @IsObject()
  @IsOptional()
  files?: Record<string, string>;
}
