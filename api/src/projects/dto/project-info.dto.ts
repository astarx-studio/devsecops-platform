import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response object returned after project creation or retrieval.
 *
 * Fields vary by capability:
 * - Deployable projects include appUrl, kongServiceName
 * - Publishable projects include packageName, registryUrl
 * - All projects include id, name, clientName, gitlabUrl, vaultPath
 */
export class ProjectInfoDto {
  @ApiProperty({ example: 42, description: 'GitLab project ID' })
  id!: number;

  @ApiProperty({ example: 'webapp', description: 'Project name' })
  name!: string;

  @ApiProperty({ example: 'acme', description: 'Client name' })
  clientName!: string;

  @ApiProperty({
    example: 'https://gitlab.devops.yourdomain.com/clients/acme/webapp',
    description: 'GitLab web URL',
  })
  gitlabUrl!: string;

  @ApiProperty({
    example: 'projects/acme/webapp',
    description: 'Vault secret path',
  })
  vaultPath!: string;

  @ApiPropertyOptional({
    example: 'webapp.apps.yourdomain.com',
    description: 'Application URL (only for deployable projects)',
  })
  appUrl?: string;

  @ApiPropertyOptional({
    example: 'acme-webapp-service',
    description: 'Kong service name (only for deployable projects)',
  })
  kongServiceName?: string;

  @ApiPropertyOptional({
    example: '@acme/webapp',
    description: 'Package name (only for publishable projects)',
  })
  packageName?: string;

  @ApiPropertyOptional({
    example: 'https://gitlab.devops.yourdomain.com/clients/acme/webapp/-/packages',
    description: 'GitLab package registry URL (only for publishable projects)',
  })
  registryUrl?: string;

  @ApiPropertyOptional({
    example: ['node-pipeline', 'docker-pipeline'],
    description: 'Config repos injected into this project',
  })
  configs?: string[];

  @ApiPropertyOptional({
    example: true,
    description: 'Whether Cloudflare DNS was configured',
  })
  cloudflareConfigured?: boolean;
}
