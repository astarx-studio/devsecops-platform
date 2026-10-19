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
import { AuditLog } from '../schemas/audit-log.schema';
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
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
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
    // Same class of bug as deployment targets: refreshChartValuesOnGitlab falls
    // back to GitLab's live default branch when no ref is passed in, ignoring
    // the branches this profile actually applies to. Commit to each of them.
    for (const branch of new Set(profile.branches)) {
      await this.projectsService.refreshChartValuesOnGitlab(doc, branch);
    }

    this.logger.log(
      `uploadProfile: project=${projectId} profile=${profileId} phase=${profile.injectionPhase} keys=${keyNames.length}`,
    );

    return profile;
  }

  /**
   * Reads Vault secret body for one profile. Returns plaintext to authorized callers only.
   *
   * @param projectId - Mongo project id
   * @param profileId - Env profile UUID
   * @returns Mode plus entries (dotenv) or rawContent (BUILD raw_file)
   */
  async getProfileContent(
    projectId: string,
    profileId: string,
  ): Promise<{
    profileId: string;
    mode: 'dotenv' | 'raw_file';
    entries: Array<{ key: string; value: string }>;
    rawContent?: string;
  }> {
    const doc = await this.findProjectOrThrow(projectId);
    const profile = this.findProfileOrThrow(doc, profileId);
    const secrets = await this.vaultService.readSecrets(profile.vaultPath);

    if (profile.injectionPhase === 'build' && profile.buildDelivery === 'raw_file') {
      const rawContent = secrets[ENV_PROFILE_RAW_CONTENT_KEY] ?? '';
      this.logger.debug(
        `getProfileContent: project=${projectId} profile=${profileId} mode=raw_file bytes=${Buffer.byteLength(rawContent, 'utf8')}`,
      );
      await this.auditLogModel.create({
        eventType: 'env.profile.revealed',
        projectId,
        gitlabPath: doc.gitlabPath,
        effectiveSlug: doc.effectiveSlug,
        metadata: {
          profileId,
          mode: 'raw_file',
          bytes: Buffer.byteLength(rawContent, 'utf8'),
        },
      });
      return {
        profileId,
        mode: 'raw_file',
        entries: [],
        rawContent,
      };
    }

    const entries = Object.entries(secrets)
      .filter(([key]) => key !== ENV_PROFILE_RAW_CONTENT_KEY)
      .map(([key, value]) => ({ key, value }));

    this.logger.debug(
      `getProfileContent: project=${projectId} profile=${profileId} mode=dotenv keys=${entries.length}`,
    );

    await this.auditLogModel.create({
      eventType: 'env.profile.revealed',
      projectId,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { profileId, mode: 'dotenv', keyCount: entries.length },
    });

    return { profileId, mode: 'dotenv', entries };
  }

  /**
   * Replaces Vault secret body for an existing profile without allocating a new UUID.
   * RUNTIME: removes previous keyNames from target paths, then merges the new map.
   *
   * @param projectId - Mongo project id
   * @param profileId - Env profile UUID
   * @param content - Full replacement body (dotenv or raw file text)
   * @returns Updated profile metadata
   */
  async updateProfileContent(
    projectId: string,
    profileId: string,
    content: string,
  ): Promise<EnvProfile> {
    const doc = await this.findProjectOrThrow(projectId);
    const profiles = doc.envProfiles ?? [];
    const index = profiles.findIndex((p) => p.id === profileId);
    if (index < 0) {
      throw new NotFoundException(`Env profile "${profileId}" not found`);
    }

    const profile = profiles[index];
    if (Buffer.byteLength(content ?? '', 'utf8') > ENV_PROFILE_MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File exceeds maximum size of ${ENV_PROFILE_MAX_FILE_BYTES} bytes`,
      );
    }

    let keyNames: string[];

    if (profile.injectionPhase === 'build' && profile.buildDelivery === 'raw_file') {
      await this.vaultService.writeSecrets(profile.vaultPath, {
        [ENV_PROFILE_RAW_CONTENT_KEY]: content,
      });
      keyNames = [ENV_PROFILE_RAW_CONTENT_KEY];
    } else if (profile.injectionPhase === 'build') {
      const parsed = parseDotenvContent(content);
      keyNames = Object.keys(parsed);
      await this.vaultService.writeSecrets(profile.vaultPath, parsed);
    } else {
      const parsed = parseDotenvContent(content);
      keyNames = Object.keys(parsed);
      await this.removeRuntimeKeysFromTargets(doc, profile);
      for (const targetKey of profile.deploymentTargetKeys ?? []) {
        const path = buildRuntimeTargetVaultPath(doc.vaultBasePath, targetKey);
        const existing = await this.vaultService.readSecrets(path);
        await this.vaultService.writeSecrets(path, { ...existing, ...parsed });
        this.logger.debug(
          `updateProfileContent: merged ${keyNames.length} keys into ${path}`,
        );
      }
      await this.vaultService.writeSecrets(profile.vaultPath, parsed);
    }

    const updated: EnvProfile = {
      ...profile,
      keyNames,
      updatedAt: new Date(),
    };
    profiles[index] = updated;
    doc.envProfiles = profiles;
    doc.runtimeEnvEnabled = this.computeRuntimeEnvEnabled(profiles);
    await doc.save();
    await this.syncCiIndex(doc);
    await this.projectsService.syncVaultAccessCiVariables(doc);
    for (const branch of new Set(updated.branches)) {
      await this.projectsService.refreshChartValuesOnGitlab(doc, branch);
    }

    this.logger.log(
      `updateProfileContent: project=${projectId} profile=${profileId} phase=${updated.injectionPhase} keys=${keyNames.length}`,
    );

    await this.auditLogModel.create({
      eventType: 'env.profile.content_updated',
      projectId,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: { profileId, keyCount: keyNames.length, injectionPhase: updated.injectionPhase },
    });

    return updated;
  }

  /**
   * Updates profile metadata without allocating a new id or rewriting secrets,
   * except RUNTIME target membership which re-merges existing keys onto the new targets.
   */
  async updateProfileMetadata(
    projectId: string,
    profileId: string,
    input: {
      label?: string;
      branches?: string[];
      deploymentTargetKeys?: string[];
      jobSelector?: string;
      workspacePath?: string;
      filename?: string;
      contentType?: string;
    },
  ): Promise<EnvProfile> {
    const doc = await this.findProjectOrThrow(projectId);
    const profiles = doc.envProfiles ?? [];
    const index = profiles.findIndex((p) => p.id === profileId);
    if (index < 0) {
      throw new NotFoundException(`Env profile "${profileId}" not found`);
    }

    const current = profiles[index];
    const nextBranches = input.branches ?? current.branches;
    if (!nextBranches.length) {
      throw new BadRequestException('At least one branch is required');
    }

    let workspacePath = current.workspacePath;
    let filename = current.filename;
    if (current.injectionPhase === 'build' && (input.workspacePath !== undefined || input.filename)) {
      workspacePath = assertValidBuildPath(
        input.workspacePath ?? current.workspacePath ?? '',
        input.filename ?? current.filename ?? '',
      );
      filename = input.filename ?? current.filename;
    }

    const nextTargets = input.deploymentTargetKeys ?? current.deploymentTargetKeys ?? [];
    const targetsChanged =
      current.injectionPhase === 'runtime' &&
      input.deploymentTargetKeys !== undefined &&
      nextTargets.join(',') !== (current.deploymentTargetKeys ?? []).join(',');

    if (targetsChanged) {
      await this.removeRuntimeKeysFromTargets(doc, current);
      const secrets = await this.vaultService.readSecrets(current.vaultPath);
      for (const targetKey of nextTargets) {
        const path = buildRuntimeTargetVaultPath(doc.vaultBasePath, targetKey);
        const existing = await this.vaultService.readSecrets(path);
        await this.vaultService.writeSecrets(path, { ...existing, ...secrets });
      }
    }

    const updated: EnvProfile = {
      ...current,
      label: input.label?.trim() || current.label,
      branches: nextBranches,
      deploymentTargetKeys: current.injectionPhase === 'runtime' ? nextTargets : current.deploymentTargetKeys,
      jobSelector: input.jobSelector !== undefined ? input.jobSelector : current.jobSelector,
      workspacePath,
      filename,
      contentType: input.contentType !== undefined ? input.contentType : current.contentType,
      updatedAt: new Date(),
    };
    profiles[index] = updated;
    doc.envProfiles = profiles;
    await doc.save();
    await this.syncCiIndex(doc);
    await this.projectsService.syncVaultAccessCiVariables(doc);
    const branchesToRefresh = new Set([...(current.branches ?? []), ...updated.branches]);
    for (const branch of branchesToRefresh) {
      await this.projectsService.refreshChartValuesOnGitlab(doc, branch);
    }

    await this.auditLogModel.create({
      eventType: 'env.profile.metadata_updated',
      projectId,
      gitlabPath: doc.gitlabPath,
      effectiveSlug: doc.effectiveSlug,
      metadata: {
        profileId,
        branches: updated.branches,
        deploymentTargetKeys: updated.deploymentTargetKeys ?? [],
        label: updated.label,
      },
    });

    return updated;
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
    // Same fix as uploadProfile: commit to the removed profile's own branches
    // instead of GitLab's live default branch.
    for (const branch of new Set(profile.branches)) {
      await this.projectsService.refreshChartValuesOnGitlab(doc, branch);
    }

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

  private findProfileOrThrow(doc: ProjectDocument, profileId: string): EnvProfile {
    const profile = (doc.envProfiles ?? []).find((p) => p.id === profileId);
    if (!profile) {
      throw new NotFoundException(`Env profile "${profileId}" not found`);
    }
    return profile;
  }
}
