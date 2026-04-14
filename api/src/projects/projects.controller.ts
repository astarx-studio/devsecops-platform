import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CombinedAuthGuard } from '../common/guards';
import { CreateProjectDto, ProjectInfoDto } from './dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiSecurity('api-key')
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new project',
    description:
      'Forks a template, injects CI config includes, provisions capabilities ' +
      '(domain + Kong for deployable, package name for publishable), seeds Vault secrets, ' +
      'and optionally configures Cloudflare DNS and triggers CI.',
  })
  @ApiResponse({ status: 201, type: ProjectInfoDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing credentials' })
  async create(@Body() dto: CreateProjectDto): Promise<ProjectInfoDto> {
    return this.projectsService.createProject(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all projects' })
  @ApiResponse({ status: 200, type: [ProjectInfoDto] })
  async findAll(): Promise<ProjectInfoDto[]> {
    return this.projectsService.listProjects();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project details by ID' })
  @ApiResponse({ status: 200, type: ProjectInfoDto })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ProjectInfoDto> {
    return this.projectsService.getProject(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a project',
    description:
      'Removes Kong routes, Cloudflare DNS, Vault secrets, and the GitLab project. ' +
      'Non-critical cleanup steps continue on failure.',
  })
  @ApiResponse({ status: 204, description: 'Project deleted' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.projectsService.deleteProject(id);
  }
}
