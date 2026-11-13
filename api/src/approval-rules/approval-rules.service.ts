import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Pool } from 'pg';
import { firstValueFrom } from 'rxjs';

import type { Model } from 'mongoose';

import { auditActorAls } from '../common/audit/audit-actor.context';
import { GitLabService } from '../gitlab/gitlab.service';
import { AuditLog } from '../projects/schemas/audit-log.schema';
import { Project } from '../projects/schemas/project.schema';

import {
  approversIn,
  buildApprovalRulesConfig,
  type ApprovalRulesConfig,
  type ApprovalRulesDraft,
} from './approval-rules.policy';

import type { AppConfiguration } from '../config';

/** Path of the per-repository fallback file the GitLab plugin reads. */
export const APPROVAL_RULES_FILE = '.gitlab/approvals.yml';

export interface ApprovalRulesView {
  projectId: string;
  gitlabProjectId: number;
  /** Which rules GitLab enforces right now. */
  source: 'console' | 'file' | 'none';
  /** Console rules; null when none are set. */
  config: ApprovalRulesConfig | null;
  updatedBy?: string;
  updatedAt?: Date;
  /** Content of the fallback file on the default branch, when it exists. */
  repositoryFile?: string;
}

/**
 * Console-managed merge request approval rules.
 *
 * Rules are stored in the GitLab plugins' own PostgreSQL database
 * (`dsoaas_gitlab_plugins`), where the approvals plugin reads them on every
 * mergeability check. The plugin owns the table (its migration creates it);
 * this service only reads and writes rows. A project with a row ignores its
 * `.gitlab/approvals.yml`; removing the row falls back to that file.
 */
@Injectable()
export class ApprovalRulesService implements OnModuleDestroy {
  private readonly logger = new Logger(ApprovalRulesService.name);
  private pool?: Pool;

  constructor(
    private readonly configService: ConfigService<AppConfiguration>,
    private readonly httpService: HttpService,
    private readonly gitlab: GitLabService,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLog>,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async get(projectId: string): Promise<ApprovalRulesView> {
    const project = await this.findProject(projectId);
    const rows = await this.query<{
      config: ApprovalRulesConfig;
      updated_by: string | null;
      updated_at: Date;
    }>(
      'SELECT config, updated_by, updated_at FROM dsoaas_approval_rule_sets WHERE project_id = $1',
      [project.gitlabProjectId],
    );
    const repositoryFile = await this.readRepositoryFile(project.gitlabProjectId);
    const row = rows[0];

    return {
      projectId,
      gitlabProjectId: project.gitlabProjectId,
      source: row ? 'console' : repositoryFile !== undefined ? 'file' : 'none',
      config: row?.config ?? null,
      updatedBy: row?.updated_by ?? undefined,
      updatedAt: row?.updated_at,
      repositoryFile,
    };
  }

  async set(projectId: string, draft: ApprovalRulesDraft): Promise<ApprovalRulesView> {
    const project = await this.findProject(projectId);

    const { config, errors } = buildApprovalRulesConfig(draft);
    if (!config) throw new BadRequestException(errors.join(' '));

    const unknown = await this.unknownApprovers(config);
    if (unknown.length) throw new BadRequestException(unknown.join(' '));

    const actor = auditActorAls.getStore()?.actor ?? null;
    await this.query(
      `INSERT INTO dsoaas_approval_rule_sets (project_id, config, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (project_id)
       DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [project.gitlabProjectId, JSON.stringify(config), actor],
    );

    await this.auditLogModel.create({
      eventType: 'project.approval_rules.updated',
      projectId,
      gitlabPath: project.gitlabPath,
      effectiveSlug: project.effectiveSlug,
      metadata: { rules: config.rules.map((r) => ({ name: r.name, required: r.required })) },
    });
    this.logger.log(
      `Approval rules set for ${project.gitlabPath} (${config.rules.length} rule(s))`,
    );

    return this.get(projectId);
  }

  async clear(projectId: string): Promise<ApprovalRulesView> {
    const project = await this.findProject(projectId);

    await this.query('DELETE FROM dsoaas_approval_rule_sets WHERE project_id = $1', [
      project.gitlabProjectId,
    ]);
    await this.auditLogModel.create({
      eventType: 'project.approval_rules.cleared',
      projectId,
      gitlabPath: project.gitlabPath,
      effectiveSlug: project.effectiveSlug,
      metadata: {},
    });
    this.logger.log(`Approval rules cleared for ${project.gitlabPath}`);

    return this.get(projectId);
  }

  private async findProject(projectId: string): Promise<Project> {
    const project = await this.projectModel.findById(projectId).lean<Project>().exec();
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    return project;
  }

  /** A typo in a username would make a rule impossible to satisfy, so check them up front. */
  private async unknownApprovers(config: ApprovalRulesConfig): Promise<string[]> {
    const baseUrl = this.configService.get('gitlab.url', { infer: true });
    const headers = { 'PRIVATE-TOKEN': this.configService.get('gitlab.token', { infer: true }) };
    const { users, groups } = approversIn(config);
    const problems: string[] = [];

    for (const username of users) {
      const res = await firstValueFrom(
        this.httpService.get<Array<{ username: string; state: string }>>(
          `${baseUrl}/api/v4/users`,
          {
            headers,
            params: { username },
          },
        ),
      );
      const user = res.data.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!user) problems.push(`GitLab user "${username}" doesn't exist.`);
      else if (user.state !== 'active')
        problems.push(`GitLab user "${username}" is ${user.state}.`);
    }

    for (const path of groups) {
      const res = await firstValueFrom(
        this.httpService.get(`${baseUrl}/api/v4/groups/${encodeURIComponent(path)}`, {
          headers,
          params: { with_projects: false },
          validateStatus: (status) => status === 200 || status === 404,
        }),
      );
      if (res.status === 404) problems.push(`GitLab group "${path}" doesn't exist.`);
    }

    return problems;
  }

  private async readRepositoryFile(gitlabProjectId: number): Promise<string | undefined> {
    try {
      const { default_branch: branch } = await this.gitlab.getProject(gitlabProjectId);
      if (!branch) return undefined;
      return (
        (await this.gitlab.getFileContent(gitlabProjectId, APPROVAL_RULES_FILE, branch)) ??
        undefined
      );
    } catch (error) {
      // Only informational for the console; the plugin reads the file itself.
      this.logger.warn(
        `Could not read ${APPROVAL_RULES_FILE} for project ${gitlabProjectId}: ${String(error)}`,
      );
      return undefined;
    }
  }

  private async query<T extends object>(sql: string, params: unknown[]): Promise<T[]> {
    try {
      const result = await this.getPool().query<T>(sql, params);
      return result.rows;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        throw new ServiceUnavailableException(
          'The GitLab approvals plugin has not set up its database yet. Check that GitLab runs the plugin image.',
        );
      }
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Approval rules database error: ${String(error)}`);
      throw new ServiceUnavailableException('The approval rules database is unreachable.');
    }
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;

    const db = this.configService.get('gitlabPlugins.db', { infer: true })!;
    if (!db.password) {
      throw new ServiceUnavailableException(
        'Approval rules are not configured: set GITLAB_PLUGINS_DB_PASSWORD for the api.',
      );
    }
    this.pool = new Pool({
      host: db.host,
      port: db.port,
      database: db.name,
      user: db.user,
      password: db.password,
      max: 3,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      application_name: 'dsoaas-api',
    });
    this.pool.on('error', (error) =>
      this.logger.warn(`Approval rules pool error: ${String(error)}`),
    );
    return this.pool;
  }
}
