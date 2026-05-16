import {
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CombinedAuthGuard } from '../common/guards';
import { ProjectsService } from './projects.service';
import { ProjectResponseDto } from './dto/project-response.dto';

/**
 * REST shim for the projects resource.
 *
 * In v2 all write operations are handled by the GraphQL API (`POST /graphql`).
 * This controller retains read-only endpoints for backward compatibility and
 * returns HTTP 410 Gone on any write path, directing clients to GraphQL.
 *
 * Write endpoints (`POST /projects`, `DELETE /projects/:id`) are preserved
 * as stubs so existing integrations receive a clear error message rather
 * than a 404.
 */
@ApiTags('Projects')
@ApiSecurity('api-key')
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all projects (read-only)',
    description: 'Returns all projects from MongoDB. Write operations require the GraphQL API.',
  })
  @ApiResponse({ status: 200, type: [ProjectResponseDto] })
  async findAll(): Promise<ProjectResponseDto[]> {
    const docs = await this.projectsService.listProjects();
    return docs.map((doc) => ProjectResponseDto.fromDocument(doc));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get project by MongoDB ID',
    description: 'Returns a single project document.',
  })
  @ApiResponse({ status: 200, type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async findOne(@Param('id') id: string): Promise<ProjectResponseDto> {
    const doc = await this.projectsService.findProject({ id });
    return ProjectResponseDto.fromDocument(doc);
  }

  @Post()
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({
    summary: 'DEPRECATED — use GraphQL createProject mutation',
    description:
      'Project creation has moved to the GraphQL API (mutation createProject). ' +
      'This endpoint returns 410 Gone.',
  })
  @ApiResponse({
    status: 410,
    description: 'Write operations have moved to GraphQL. POST /graphql',
  })
  createGone(): never {
    throw new GoneException({
      message: 'Project write operations have moved to the GraphQL API.',
      graphqlEndpoint: '/graphql',
      hint: 'Use mutation createProject(input: CreateProjectInput!): Project!',
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({
    summary: 'DEPRECATED — use GraphQL deleteProject mutation',
    description:
      'Project deletion has moved to the GraphQL API (mutation deleteProject). ' +
      'This endpoint returns 410 Gone.',
  })
  @ApiResponse({
    status: 410,
    description: 'Write operations have moved to GraphQL. POST /graphql',
  })
  deleteGone(): never {
    throw new GoneException({
      message: 'Project write operations have moved to the GraphQL API.',
      graphqlEndpoint: '/graphql',
      hint: 'Use mutation deleteProject(id: ID!): Boolean!',
    });
  }
}
