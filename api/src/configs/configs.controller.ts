import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CombinedAuthGuard } from '../common/guards';
import { ConfigInfoDto, CreateConfigDto, UpdateConfigFilesDto } from './dto';
import { ConfigsService } from './configs.service';

@ApiTags('Configs')
@ApiSecurity('api-key')
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller('configs')
export class ConfigsController {
  constructor(private readonly configsService: ConfigsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all shared CI/CD configs',
    description: 'Returns all config repos from the GitLab configs group.',
  })
  @ApiResponse({ status: 200, type: [ConfigInfoDto] })
  async findAll(): Promise<ConfigInfoDto[]> {
    return this.configsService.listConfigs();
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'Get config details by slug',
    description: 'Returns config info including the repository file tree.',
  })
  @ApiResponse({ status: 200, type: ConfigInfoDto })
  @ApiResponse({ status: 404, description: 'Config not found' })
  async findOne(@Param('slug') slug: string): Promise<ConfigInfoDto> {
    return this.configsService.getConfig(slug);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new shared CI/CD config',
    description: 'Creates a new config repo in the configs group with an initial .gitlab-ci.yml.',
  })
  @ApiResponse({ status: 201, type: ConfigInfoDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Config already exists' })
  async create(@Body() dto: CreateConfigDto): Promise<ConfigInfoDto> {
    return this.configsService.createConfig(dto);
  }

  @Put(':slug/files')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Update files in a config repo',
    description: 'Creates or updates a file in the config repo and commits the change.',
  })
  @ApiResponse({ status: 204, description: 'File updated' })
  @ApiResponse({ status: 404, description: 'Config not found' })
  async updateFiles(@Param('slug') slug: string, @Body() dto: UpdateConfigFilesDto): Promise<void> {
    return this.configsService.updateConfigFiles(slug, dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a config repo',
    description: 'Permanently deletes the config repo from GitLab.',
  })
  @ApiResponse({ status: 204, description: 'Config deleted' })
  @ApiResponse({ status: 404, description: 'Config not found' })
  async remove(@Param('slug') slug: string): Promise<void> {
    return this.configsService.deleteConfig(slug);
  }
}
