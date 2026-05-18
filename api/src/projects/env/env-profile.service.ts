import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { VaultService } from '../../vault/vault.service';
import { ProjectsService } from '../projects.service';
import { Project, type EnvProfile, type ProjectDocument } from '../schemas/project.schema';

import type { CiEnvIndex } from './ci-index.types';
import {
  ENV_PROFILE_CI_INDEX_SUFFIX,
  ENV_PROFILE_MAX_FILE_BYTES,
  ENV_PROFILE_RAW_CONTENT_KEY,
  type EnvProfileBuildDelivery,
  type EnvProfileInjectionPhase,
} from './env-profile.constants';
import { parseDotenvContent } from './dotenv.parser';
import {
  buildProfilesConflict,
  formatBuildProfileDestination,
} from './env-profile-overlap.util';
import {
  assertValidBuildPath,
  buildProfileVaultPath,
  buildRuntimeTargetVaultPath,
  suggestBuildDelivery,
} from './env-profile-path.util';

export interface UploadEnvProfileParams {
  label: string;
  injectionPhase: EnvProfileInjectionPhase;
  branches: string[];
  content: string;
  deploymentTargetKeys?: string[];
  jobSelector?: string;
  workspacePath?: string;
  filename?: string;
  buildDelivery?: EnvProfileBuildDelivery;
  contentType?: string;
}

/**
 * Manages branch-scoped env profiles: Vault storage, Mongo metadata, and CI index sync.
 */
@Injectable()
export class EnvProfileService {
  private readonly logger = new Logger(EnvProfileService.name);

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    private readonly vaultService: VaultService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
  ) {}

  async listProfiles(projectId: string): Promise<EnvProfile[]> {
    const doc = await this.findProjectOrThrow(projectId);
    return doc.envProfiles ?? [];
  }

  async uploadProfile(projectId: string, params: UploadEnvProfileParams): Promise<EnvProfile> {
    const doc = await this.findProjectOrThrow(projectId);
    const content = params.content ?? '';
    if (Buffer.byteLength(content, 'utf8') > ENV_PROFILE_MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File exceeds maximum size of ${ENV_PROFILE_MAX_FILE_BYTES} bytes`,
      );
    }

    if (!params.branches?.length) {
      throw new BadRequestException('At least one branch is required');
    }

    const profileId = randomUUID();
    let keyNames: string[] = [];
    let resolvedBuildDelivery: EnvProfileBuildDelivery | undefined;
    let normalizedWorkspacePath: string | undefined;

    if (params.injectionPhase === 'build') {
      const buildResult = await this.writeBuildProfile(doc, profileId, params, content);
      keyNames = buildResult.keyNames;
      resolvedBuildDelivery = buildResult.buildDelivery;
      normalizedWorkspacePath = buildResult.workspacePath;
    } else {
      keyNames = await this.writeRuntimeProfile(doc, profileId, params, content);
    }

    const vaultPath =
      params.injectionPhase === 'build'
        ? buildProfileVaultPath(doc.vaultBasePath, profileId)
        : `${doc.vaultBasePath}/ci/runtime/${profileId}`;

    const profile: EnvProfile = {
      id: profileId,
      label: params.label,
      injectionPhase: params.injectionPhase,
      branches: [...params.branches],
      deploymentTargetKeys:
        params.injectionPhase === 'runtime' ? [...(params.deploymentTargetKeys ?? [])] : [],
      jobSelector: params.jobSelector?.trim() || undefined,
      workspacePath: params.injectionPhase === 'build' ? normalizedWorkspacePath : undefined,
      filename: params.injectionPhase === 'build' ? params.filename : undefined,
      buildDelivery: params.injectionPhase === 'build' ? resolvedBuildDelivery : undefined,
      vaultPath,
      contentType: params.contentType,
      keyNames,
      updatedAt: new Date(),
    };

    this.assertNoProfileOverlap(doc.envProfiles ?? [], profile);

    doc.envProfiles = [...(doc.envProfiles ?? []), profile];
    doc.runtimeEnvEnabled = this.computeRuntimeEnvEnabled(doc.envProfiles);
    await doc.save();
    await this.syncCiIndex(doc);
    await this.projectsService.syncVaultAccessCiVariables(doc);
    await this.projectsService.refreshChartValuesOnGitlab(doc);

    this.logger.log(
      `uploadProfile: project=${projectId} profile=${profileId} phase=${profile.injectionPhase} keys=${keyNames.length}`,
    );

    return profile;
  }

  async deleteProfile(projectId: string, profileId: string): Promise<ProjectDocument> {
    const doc = await this.findProjectOrThrow(projectId);
    const existing = doc.envProfiles ?? [];
    const profile = existing.find((p) => p.id === profileId);
    if (!profile) {
      throw new NotFoundException(`Env profile "${profileId}" not found`);
    }

    if (profile.injectionPhase === 'build') {
      await this.vaultService.deleteSecrets(profile.vaultPath);
    } else {
      await this.removeRuntimeKeysFromTargets(doc, profile);
      await this.vaultService.deleteSecrets(profile.vaultPath);
    }

    doc.envProfiles = existing.filter((p) => p.id !== profileId);
    doc.runtimeEnvEnabled = this.computeRuntimeEnvEnabled(doc.envProfiles);
    await doc.save();
    await this.syncCiIndex(doc);
    await this.projectsService.syncVaultAccessCiVariables(doc);
    await this.projectsService.refreshChartValuesOnGitlab(doc);

    return doc;
  }

  /** Rebuilds Vault ci/index from Mongo envProfiles. */
  async syncCiIndex(doc: ProjectDocument): Promise<void> {
    const index: CiEnvIndex = {
      version: 1,
      profiles: (doc.envProfiles ?? []).map((p) => ({
        id: p.id,
        injectionPhase: p.injectionPhase,
        branches: p.branches,
        jobSelector: p.jobSelector,
        buildDelivery: p.buildDelivery,
        workspacePath: p.workspacePath,
        filename: p.filename,
        vaultPath: p.vaultPath,
      })),
    };

    await this.vaultService.writeSecrets(`${doc.vaultBasePath}/${ENV_PROFILE_CI_INDEX_SUFFIX}`, {
      _index_json: JSON.stringify(index),
    });
  }

  computeRuntimeEnvEnabled(profiles: EnvProfile[]): boolean {
    return profiles.some((p) => p.injectionPhase === 'runtime');
  }

  private async writeBuildProfile(
    doc: ProjectDocument,
    profileId: string,
    params: UploadEnvProfileParams,
    content: string,
  ): Promise<{
    keyNames: string[];
    buildDelivery: EnvProfileBuildDelivery;
    workspacePath: string;
  }> {
    if (!params.filename || params.workspacePath === undefined) {
      throw new BadRequestException('workspacePath and filename are required for BUILD profiles');
    }

    const workspacePath = assertValidBuildPath(params.workspacePath, params.filename);

    const delivery = params.buildDelivery ?? suggestBuildDelivery(params.filename);
    const vaultPath = buildProfileVaultPath(doc.vaultBasePath, profileId);

    if (delivery === 'raw_file') {
      await this.vaultService.writeSecrets(vaultPath, {
        [ENV_PROFILE_RAW_CONTENT_KEY]: content,
      });
      return {
        keyNames: [ENV_PROFILE_RAW_CONTENT_KEY],
        buildDelivery: delivery,
        workspacePath,
      };
    }

    const parsed = parseDotenvContent(content);
    await this.vaultService.writeSecrets(vaultPath, parsed);
    return { keyNames: Object.keys(parsed), buildDelivery: delivery, workspacePath };
  }

  private async removeRuntimeKeysFromTargets(
    doc: ProjectDocument,
    profile: EnvProfile,
  ): Promise<void> {
    for (const targetKey of profile.deploymentTargetKeys ?? []) {
      const path = buildRuntimeTargetVaultPath(doc.vaultBasePath, targetKey);
      const existing = await this.vaultService.readSecrets(path);
      for (const key of profile.keyNames ?? []) {
        delete existing[key];
      }
      await this.vaultService.writeSecrets(path, existing);
    }
  }

  private async writeRuntimeProfile(
    doc: ProjectDocument,
    profileId: string,
    params: UploadEnvProfileParams,
    content: string,
  ): Promise<string[]> {
    const targetKeys = params.deploymentTargetKeys ?? [];
    if (!targetKeys.length) {
      throw new BadRequestException(
        'deploymentTargetKeys is required for RUNTIME profiles (select at least one deployment target)',
      );
    }

    const knownKeys = new Set((doc.deploymentTargets ?? []).map((t) => t.key));
    for (const key of targetKeys) {
      if (!knownKeys.has(key)) {
        throw new BadRequestException(
          `Unknown deployment target "${key}". Known targets: ${[...knownKeys].join(', ')}`,
        );
      }
    }

    const parsed = parseDotenvContent(content);
    const keyNames = Object.keys(parsed);

    for (const targetKey of targetKeys) {
      const path = buildRuntimeTargetVaultPath(doc.vaultBasePath, targetKey);
      const existing = await this.vaultService.readSecrets(path);
      await this.vaultService.writeSecrets(path, { ...existing, ...parsed });
      this.logger.debug(`writeRuntimeProfile: merged ${keyNames.length} keys into ${path}`);
    }

    await this.vaultService.writeSecrets(`${doc.vaultBasePath}/ci/runtime/${profileId}`, parsed);

    return keyNames;
  }

  private assertNoProfileOverlap(existing: EnvProfile[], incoming: EnvProfile): void {
    for (const branch of incoming.branches) {
      for (const other of existing) {
        if (other.id === incoming.id) {
          continue;
        }
        if (!other.branches.includes(branch)) {
          continue;
        }
        if (other.injectionPhase !== incoming.injectionPhase) {
          continue;
        }

        if (incoming.injectionPhase === 'runtime') {
          const jobA = (other.jobSelector ?? '').trim();
          const jobB = (incoming.jobSelector ?? '').trim();
          if (jobA !== jobB) {
            continue;
          }
          const targetsA = other.deploymentTargetKeys ?? [];
          const targetsB = incoming.deploymentTargetKeys ?? [];
          const overlap = targetsA.some((t) => targetsB.includes(t));
          if (overlap) {
            throw new BadRequestException(
              `Env profile overlaps branch "${branch}", job selector, and deployment target for phase runtime`,
            );
          }
          continue;
        }

        if (!buildProfilesConflict(other, incoming)) {
          continue;
        }

        throw new BadRequestException(
          `Env profile already exists for branch "${branch}" (${formatBuildProfileDestination(incoming)})`,
        );
      }
    }
  }

  private async findProjectOrThrow(projectId: string): Promise<ProjectDocument> {
    const doc = await this.projectModel.findById(projectId);
    if (!doc) {
      throw new NotFoundException(`Project "${projectId}" not found`);
    }
    return doc;
  }
}
