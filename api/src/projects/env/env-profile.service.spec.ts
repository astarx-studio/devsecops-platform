import { BadRequestException, NotFoundException } from '@nestjs/common';

import { VaultService } from '../../vault/vault.service';
import { ProjectsService } from '../projects.service';
import { ENV_PROFILE_RAW_CONTENT_KEY } from './env-profile.constants';
import { EnvProfileService } from './env-profile.service';

import type { EnvProfile, ProjectDocument } from '../schemas/project.schema';

function makeDoc(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  const doc = {
    _id: 'proj-1',
    vaultBasePath: 'projects/acme/web',
    deploymentTargets: [{ key: 'dev' }, { key: 'stg' }],
    envProfiles: [] as EnvProfile[],
    runtimeEnvEnabled: false,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc as unknown as ProjectDocument;
}

describe('EnvProfileService', () => {
  let service: EnvProfileService;
  let projectModel: { findById: jest.Mock };
  let vaultService: {
    readSecrets: jest.Mock;
    writeSecrets: jest.Mock;
    deleteSecrets: jest.Mock;
  };
  let projectsService: {
    syncVaultAccessCiVariables: jest.Mock;
    refreshChartValuesOnGitlab: jest.Mock;
  };

  beforeEach(() => {
    projectModel = {
      findById: jest.fn(),
    };
    vaultService = {
      readSecrets: jest.fn().mockResolvedValue({}),
      writeSecrets: jest.fn().mockResolvedValue(undefined),
      deleteSecrets: jest.fn().mockResolvedValue(undefined),
    };
    projectsService = {
      syncVaultAccessCiVariables: jest.fn().mockResolvedValue(undefined),
      refreshChartValuesOnGitlab: jest.fn().mockResolvedValue(undefined),
    };

    service = new EnvProfileService(
      projectModel as never,
      vaultService as unknown as VaultService,
      projectsService as unknown as ProjectsService,
    );
  });

  describe('getProfileContent', () => {
    it('returns raw_file mode for BUILD raw_file profiles', async () => {
      const profile: EnvProfile = {
        id: 'p-raw',
        label: 'raw',
        injectionPhase: 'build',
        branches: ['main'],
        deploymentTargetKeys: [],
        vaultPath: 'projects/acme/web/ci/build/p-raw',
        buildDelivery: 'raw_file',
        keyNames: [ENV_PROFILE_RAW_CONTENT_KEY],
      };
      projectModel.findById.mockResolvedValue(makeDoc({ envProfiles: [profile] }));
      vaultService.readSecrets.mockResolvedValue({
        [ENV_PROFILE_RAW_CONTENT_KEY]: 'server.port=8080\n',
      });

      const result = await service.getProfileContent('proj-1', 'p-raw');

      expect(result).toEqual({
        profileId: 'p-raw',
        mode: 'raw_file',
        entries: [],
        rawContent: 'server.port=8080\n',
      });
    });

    it('returns dotenv entries for RUNTIME profiles', async () => {
      const profile: EnvProfile = {
        id: 'p-rt',
        label: 'runtime',
        injectionPhase: 'runtime',
        branches: ['main'],
        deploymentTargetKeys: ['dev'],
        vaultPath: 'projects/acme/web/ci/runtime/p-rt',
        keyNames: ['DB_URL', 'API_KEY'],
      };
      projectModel.findById.mockResolvedValue(makeDoc({ envProfiles: [profile] }));
      vaultService.readSecrets.mockResolvedValue({
        DB_URL: 'postgres://x',
        API_KEY: 'secret',
      });

      const result = await service.getProfileContent('proj-1', 'p-rt');

      expect(result.mode).toBe('dotenv');
      expect(result.entries).toEqual(
        expect.arrayContaining([
          { key: 'DB_URL', value: 'postgres://x' },
          { key: 'API_KEY', value: 'secret' },
        ]),
      );
    });

    it('throws when profile is missing', async () => {
      projectModel.findById.mockResolvedValue(makeDoc({ envProfiles: [] }));
      await expect(service.getProfileContent('proj-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateProfileContent', () => {
    it('overwrites BUILD dotenv vault path and refreshes keyNames', async () => {
      const profile: EnvProfile = {
        id: 'p-build',
        label: 'build',
        injectionPhase: 'build',
        branches: ['main'],
        deploymentTargetKeys: [],
        vaultPath: 'projects/acme/web/ci/build/p-build',
        buildDelivery: 'dotenv_build_args',
        workspacePath: '',
        filename: '.env',
        keyNames: ['OLD'],
      };
      const doc = makeDoc({ envProfiles: [profile] });
      projectModel.findById.mockResolvedValue(doc);

      const updated = await service.updateProfileContent(
        'proj-1',
        'p-build',
        'NEW_A=1\nNEW_B=2\n',
      );

      expect(vaultService.writeSecrets).toHaveBeenCalledWith(profile.vaultPath, {
        NEW_A: '1',
        NEW_B: '2',
      });
      expect(updated.keyNames).toEqual(['NEW_A', 'NEW_B']);
      expect(doc.save).toHaveBeenCalled();
      expect(projectsService.refreshChartValuesOnGitlab).toHaveBeenCalledWith(doc, 'main');
    });

    it('overwrites BUILD raw_file content key', async () => {
      const profile: EnvProfile = {
        id: 'p-raw',
        label: 'raw',
        injectionPhase: 'build',
        branches: ['develop'],
        deploymentTargetKeys: [],
        vaultPath: 'projects/acme/web/ci/build/p-raw',
        buildDelivery: 'raw_file',
        keyNames: [ENV_PROFILE_RAW_CONTENT_KEY],
      };
      const doc = makeDoc({ envProfiles: [profile] });
      projectModel.findById.mockResolvedValue(doc);

      const updated = await service.updateProfileContent(
        'proj-1',
        'p-raw',
        'fresh-body',
      );

      expect(vaultService.writeSecrets).toHaveBeenCalledWith(profile.vaultPath, {
        [ENV_PROFILE_RAW_CONTENT_KEY]: 'fresh-body',
      });
      expect(updated.keyNames).toEqual([ENV_PROFILE_RAW_CONTENT_KEY]);
    });

    it('removes previous RUNTIME keys from targets then merges new map', async () => {
      const profile: EnvProfile = {
        id: 'p-rt',
        label: 'runtime',
        injectionPhase: 'runtime',
        branches: ['main', 'develop'],
        deploymentTargetKeys: ['dev', 'stg'],
        vaultPath: 'projects/acme/web/ci/runtime/p-rt',
        keyNames: ['OLD_KEY', 'KEEP_ME'],
      };
      const doc = makeDoc({ envProfiles: [profile] });
      projectModel.findById.mockResolvedValue(doc);

      const store: Record<string, Record<string, string>> = {
        'projects/acme/web/dev': { OLD_KEY: 'a', KEEP_ME: 'b', OTHER: 'keep' },
        'projects/acme/web/stg': { OLD_KEY: 'a', KEEP_ME: 'b', OTHER: 'keep' },
      };
      vaultService.readSecrets.mockImplementation(async (path: string) => ({
        ...(store[path] ?? {}),
      }));
      vaultService.writeSecrets.mockImplementation(async (path: string, data: Record<string, string>) => {
        store[path] = { ...data };
      });

      const updated = await service.updateProfileContent(
        'proj-1',
        'p-rt',
        'KEEP_ME=new\nNEW_KEY=z\n',
      );

      expect(store['projects/acme/web/dev']).toEqual({
        OTHER: 'keep',
        KEEP_ME: 'new',
        NEW_KEY: 'z',
      });
      expect(store['projects/acme/web/stg']).toEqual({
        OTHER: 'keep',
        KEEP_ME: 'new',
        NEW_KEY: 'z',
      });
      expect(store[profile.vaultPath]).toEqual({
        KEEP_ME: 'new',
        NEW_KEY: 'z',
      });
      expect(updated.keyNames).toEqual(['KEEP_ME', 'NEW_KEY']);
      expect(projectsService.refreshChartValuesOnGitlab).toHaveBeenCalledWith(doc, 'main');
      expect(projectsService.refreshChartValuesOnGitlab).toHaveBeenCalledWith(doc, 'develop');
    });

    it('rejects oversize content', async () => {
      const profile: EnvProfile = {
        id: 'p-rt',
        label: 'runtime',
        injectionPhase: 'runtime',
        branches: ['main'],
        deploymentTargetKeys: ['dev'],
        vaultPath: 'projects/acme/web/ci/runtime/p-rt',
        keyNames: ['A'],
      };
      projectModel.findById.mockResolvedValue(makeDoc({ envProfiles: [profile] }));

      const huge = `A=${'x'.repeat(300 * 1024)}`;
      await expect(service.updateProfileContent('proj-1', 'p-rt', huge)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
