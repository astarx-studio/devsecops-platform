import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ProjectDocument } from '../schemas/project.schema';

/**
 * REST response shape for project read operations.
 *
 * Maps from the v2 MongoDB `Project` document. Used by
 * `GET /projects` and `GET /projects/:id` (the read-only REST shim).
 *
 * Write operations are handled exclusively by the GraphQL API.
 */
export class ProjectResponseDto {
  @ApiProperty({ example: '6650f1a2b3c4d5e6f7890123', description: 'MongoDB document ID.' })
  id!: string;

  @ApiProperty({ example: 42, description: 'GitLab numeric project ID.' })
  gitlabProjectId!: number;

  @ApiProperty({
    example: 'groupa/groupab/repoa',
    description: 'Full GitLab path (path_with_namespace).',
  })
  gitlabPath!: string;

  @ApiProperty({
    example: ['groupa', 'groupab'],
    description: 'Ordered group path segments.',
    type: [String],
  })
  groupPath!: string[];

  @ApiProperty({ example: 'repoa', description: 'User-supplied leaf slug.' })
  projectSlug!: string;

  @ApiProperty({
    example: 'repoa',
    description: 'Resolved slug used as Helm release name and hostname prefix.',
  })
  effectiveSlug!: string;

  @ApiPropertyOptional({ example: 'My Application', description: 'Optional display name.' })
  displayName?: string;

  @ApiProperty({
    example: 'auto-devops',
    enum: ['auto-devops', 'template'],
    description: 'Provisioning strategy.',
  })
  provisioning!: string;

  @ApiProperty({
    example: 'projects/groupa/groupab/repoa',
    description: 'Vault KV v2 base path.',
  })
  vaultBasePath!: string;

  @ApiProperty({ example: 'repoa', description: 'Helm release name (equals effectiveSlug).' })
  helmReleaseName!: string;

  @ApiPropertyOptional({
    description: 'Application hostnames per environment.',
    example: { dev: 'repoa.dev.apps.example.com', stg: 'repoa.stg.apps.example.com', prod: 'repoa.apps.example.com' },
  })
  appHosts?: { dev?: string; stg?: string; prod?: string };

  @ApiProperty({ description: 'Capability flags.', example: { deployable: true, publishable: false } })
  capabilities!: { deployable: boolean; publishable: boolean };

  @ApiProperty({ example: false, description: 'True for v1 legacy projects.' })
  legacyV1!: boolean;

  @ApiProperty({ example: false, description: 'True for projects pinned on v1 indefinitely.' })
  pinnedV1!: boolean;

  @ApiProperty({ example: '2026-05-12T00:00:00.000Z', description: 'Creation timestamp.' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-05-12T00:00:00.000Z', description: 'Last modification timestamp.' })
  updatedAt!: Date;

  /**
   * Maps a Mongoose ProjectDocument to this DTO.
   *
   * @param doc - Mongoose document instance
   * @returns Populated DTO ready for JSON serialisation
   */
  static fromDocument(doc: ProjectDocument): ProjectResponseDto {
    const dto = new ProjectResponseDto();
    dto.id = String(doc._id);
    dto.gitlabProjectId = doc.gitlabProjectId;
    dto.gitlabPath = doc.gitlabPath;
    dto.groupPath = doc.groupPath;
    dto.projectSlug = doc.projectSlug;
    dto.effectiveSlug = doc.effectiveSlug;
    dto.displayName = doc.displayName;
    dto.provisioning = doc.provisioning;
    dto.vaultBasePath = doc.vaultBasePath;
    dto.helmReleaseName = doc.helmReleaseName;
    dto.appHosts = doc.appHosts;
    dto.capabilities = doc.capabilities;
    dto.legacyV1 = doc.legacyV1;
    dto.pinnedV1 = doc.pinnedV1;
    dto.createdAt = doc.createdAt!;
    dto.updatedAt = doc.updatedAt!;
    return dto;
  }
}
