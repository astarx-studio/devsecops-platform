import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { GitLabTreeItem } from '../../gitlab/gitlab.service';

/**
 * Response object describing a template repository.
 *
 * @property id - GitLab project ID
 * @property slug - URL-safe identifier (project path)
 * @property description - Human-readable description
 * @property gitlabUrl - Full GitLab web URL
 * @property defaultBranch - Default branch name
 * @property lastActivityAt - ISO 8601 timestamp of last repo activity
 * @property files - Repository file tree (only present on detail endpoint)
 */
export class TemplateInfoDto {
  @ApiProperty({ example: 10, description: 'GitLab project ID' })
  id!: number;

  @ApiProperty({ example: 'nestjs-app', description: 'Template slug' })
  slug!: string;

  @ApiPropertyOptional({
    example: 'Production-ready NestJS starter',
    description: 'Template description',
  })
  description?: string | null;

  @ApiProperty({
    example: 'https://gitlab.devops.yourdomain.com/templates/nestjs-app',
    description: 'GitLab web URL',
  })
  gitlabUrl!: string;

  @ApiPropertyOptional({ example: 'main', description: 'Default branch' })
  defaultBranch?: string;

  @ApiPropertyOptional({
    example: '2026-04-13T10:30:00.000Z',
    description: 'Last activity timestamp',
  })
  lastActivityAt?: string;

  @ApiPropertyOptional({
    description: 'Repository file tree (detail endpoint only)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        path: { type: 'string' },
        type: { type: 'string', enum: ['tree', 'blob'] },
      },
    },
  })
  files?: GitLabTreeItem[];
}
