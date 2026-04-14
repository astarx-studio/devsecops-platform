import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for updating files in a config repository.
 *
 * Commits updated content to the specified file path within the config repo.
 *
 * @property filePath - Path within the repository (e.g. ".gitlab-ci.yml" or "ci/build.yml")
 * @property content - New file content (plain text)
 * @property commitMessage - Commit message describing the change
 */
export class UpdateConfigFilesDto {
  @ApiProperty({
    example: '.gitlab-ci.yml',
    description: 'File path within the config repo',
  })
  @IsString()
  @IsNotEmpty()
  filePath!: string;

  @ApiProperty({
    example:
      '.lint:\n  stage: lint\n  image: node:20-alpine\n  script:\n    - pnpm install --frozen-lockfile\n    - pnpm run lint\n',
    description: 'New file content (plain text)',
  })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({
    example: 'chore: update lint stage to use pnpm v9',
    description: 'Git commit message for the file update',
  })
  @IsString()
  @IsNotEmpty()
  commitMessage!: string;
}
