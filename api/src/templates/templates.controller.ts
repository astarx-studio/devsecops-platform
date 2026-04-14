import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CombinedAuthGuard } from '../common/guards';
import { CreateTemplateDto, TemplateInfoDto } from './dto';
import { TemplatesService } from './templates.service';

@ApiTags('Templates')
@ApiSecurity('api-key')
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all project templates',
    description: 'Returns all template repos from the GitLab templates group.',
  })
  @ApiResponse({ status: 200, type: [TemplateInfoDto] })
  async findAll(): Promise<TemplateInfoDto[]> {
    return this.templatesService.listTemplates();
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'Get template details by slug',
    description: 'Returns template info including the repository file tree.',
  })
  @ApiResponse({ status: 200, type: TemplateInfoDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findOne(@Param('slug') slug: string): Promise<TemplateInfoDto> {
    return this.templatesService.getTemplate(slug);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new project template',
    description:
      'Creates a new template repo in the templates group, optionally populated with initial files.',
  })
  @ApiResponse({ status: 201, type: TemplateInfoDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Template already exists' })
  async create(@Body() dto: CreateTemplateDto): Promise<TemplateInfoDto> {
    return this.templatesService.createTemplate(dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a template',
    description: 'Permanently deletes the template repo from GitLab.',
  })
  @ApiResponse({ status: 204, description: 'Template deleted' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async remove(@Param('slug') slug: string): Promise<void> {
    return this.templatesService.deleteTemplate(slug);
  }
}
