import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

/** Result of ensuring a Sonar project exists. */
export interface SonarEnsureProjectResult {
  projectKey: string;
  created: boolean;
}

/**
 * SonarQube Web API client for platform-managed project provisioning.
 *
 * Uses admin credentials (SONAR_ADMIN_USER / SONAR_ADMIN_PASSWORD) to create
 * analysis projects before the first CI scan. CI still uses SONAR_TOKEN on the
 * GitLab project (typically a global analysis token with Execute Analysis).
 */
@Injectable()
export class SonarQubeService {
  private readonly logger = new Logger(SonarQubeService.name);
  private readonly baseUrl: string;
  private readonly auth: { username: string; password: string } | null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {
    this.baseUrl = this.configService
      .get('sonarqube.internalUrl', { infer: true })
      .replace(/\/$/, '');
    const username = this.configService.get('sonarqube.adminUser', { infer: true });
    const password = this.configService.get('sonarqube.adminPassword', { infer: true });
    this.auth = username && password ? { username, password } : null;
  }

  /**
   * Returns true when admin API credentials are configured.
   */
  isConfigured(): boolean {
    return this.auth !== null;
  }

  /**
   * Creates the Sonar project if it does not exist (idempotent).
   *
   * @param projectKey - Sonar project key (see buildSonarProjectKey)
   * @param projectName - Display name in Sonar UI
   * @param mainBranch - Optional main branch label stored on the Sonar project
   */
  async ensureProject(
    projectKey: string,
    projectName: string,
    mainBranch?: string,
  ): Promise<SonarEnsureProjectResult> {
    this.assertConfigured();

    const exists = await this.projectExists(projectKey);
    if (exists) {
      this.logger.debug(`Sonar project already exists: ${projectKey}`);
      return { projectKey, created: false };
    }

    await this.createProject(projectKey, projectName, mainBranch);
    this.logger.log(`Created Sonar project key=${projectKey} name="${projectName}"`);
    return { projectKey, created: true };
  }

  /**
   * Creates a global analysis token for CI (can analyze any Sonar project the user may scan).
   *
   * @param tokenName - Unique token label in SonarQube
   * @returns The token value (shown only once by Sonar)
   */
  async generateGlobalAnalysisToken(tokenName: string): Promise<string> {
    this.assertConfigured();

    try {
      const body = new URLSearchParams({
        name: tokenName,
        type: 'GLOBAL_ANALYSIS_TOKEN',
      });
      const { data } = await firstValueFrom(
        this.httpService.post<{ token?: string }>(
          `${this.baseUrl}/api/user_tokens/generate`,
          body.toString(),
          {
            auth: this.auth!,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );
      if (!data.token) {
        throw new ServiceUnavailableException(
          'SonarQube did not return a token from user_tokens/generate.',
        );
      }
      this.logger.log(`Generated Sonar global analysis token name=${tokenName}`);
      return data.token;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logAndThrow('generate analysis token', tokenName, error);
    }
  }

  /**
   * Deletes a Sonar project by key. No-op when the project is missing.
   *
   * @param projectKey - Sonar project key
   */
  async deleteProject(projectKey: string): Promise<void> {
    this.assertConfigured();

    const exists = await this.projectExists(projectKey);
    if (!exists) {
      this.logger.debug(`Sonar project not found for delete: ${projectKey}`);
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/projects/delete`, null, {
          params: { project: projectKey },
          auth: this.auth!,
        }),
      );
      this.logger.log(`Deleted Sonar project key=${projectKey}`);
    } catch (error) {
      this.logAndThrow('delete project', projectKey, error);
    }
  }

  private assertConfigured(): void {
    if (!this.auth) {
      throw new BadRequestException(
        'SonarQube admin API is not configured. Set SONAR_ADMIN_USER and SONAR_ADMIN_PASSWORD on the API service.',
      );
    }
  }

  private async projectExists(projectKey: string): Promise<boolean> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ components?: Array<{ key: string }> }>(
          `${this.baseUrl}/api/projects/search`,
          {
            params: { projects: projectKey },
            auth: this.auth!,
          },
        ),
      );
      return (data.components?.length ?? 0) > 0;
    } catch (error) {
      this.logAndThrow('search project', projectKey, error);
    }
  }

  private async createProject(
    projectKey: string,
    projectName: string,
    mainBranch?: string,
  ): Promise<void> {
    const params: Record<string, string> = {
      project: projectKey,
      name: projectName,
    };
    if (mainBranch) {
      params.main = mainBranch;
    }

    try {
      await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/projects/create`, null, {
          params,
          auth: this.auth!,
        }),
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 400) {
        const exists = await this.projectExists(projectKey);
        if (exists) {
          return;
        }
      }
      this.logAndThrow('create project', projectKey, error);
    }
  }

  private logAndThrow(action: string, projectKey: string, error: unknown): never {
    const status = (error as { response?: { status?: number } }).response?.status;
    const body = (error as { response?: { data?: unknown } }).response?.data;
    this.logger.error(
      `SonarQube failed to ${action} key=${projectKey} status=${status ?? 'unknown'} body=${JSON.stringify(body)}`,
    );
    if (status === 401 || status === 403) {
      throw new BadRequestException(
        'SonarQube rejected admin credentials. Check SONAR_ADMIN_USER and SONAR_ADMIN_PASSWORD.',
      );
    }
    throw new ServiceUnavailableException(
      `SonarQube is unavailable or rejected the ${action} request for "${projectKey}".`,
    );
  }
}
