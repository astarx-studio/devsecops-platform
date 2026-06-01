import { ConflictException, NotFoundException } from '@nestjs/common';

import { SonarQubeService } from '../sonarqube/sonarqube.service';
import { ProjectsService } from './projects.service';
import { GitLabService } from '../gitlab/gitlab.service';
import { K8sService } from '../k8s/k8s.service';
import { VaultService } from '../vault/vault.service';
import { SlugService } from './slug.service';
import { Project } from './schemas/project.schema';
import { Provisioning } from './graphql/enums';
import { createMockConfigService } from '../../test/helpers/mock-providers';
import { gitlabProjectFactory } from '../../test/helpers/factories';

import type { CreateProjectInput } from './graphql/project.inputs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockModel(docs: Partial<Project>[] = []) {
  const mockDoc = {
    _id: 'mock-doc-id',
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    ...docs[0],
  };

  return {
    find: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    }),
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    }),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    }),
    create: jest.fn().mockResolvedValue(mockDoc),
  };
}

function createMockAuditModel() {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Mocked forked project fixture
// ---------------------------------------------------------------------------

const forkedProject = gitlabProjectFactory({
  id: 42,
  name: 'repoa',
  path_with_namespace: 'groupa/groupab/repoa',
  web_url: 'https://gitlab.devops.test.net/groupa/groupab/repoa',
});

describe('ProjectsService', () => {
  let service: ProjectsService;

  let projectModel: ReturnType<typeof createMockModel>;
  let auditLogModel: ReturnType<typeof createMockAuditModel>;

  let createGroupHierarchyFn: jest.Mock;
  let forkTemplateFn: jest.Mock;
  let createNewProjectFn: jest.Mock;
  let upsertFileFn: jest.Mock;
  let triggerPipelineFn: jest.Mock;
  let listProjectsFn: jest.Mock;
  let deleteProjectFn: jest.Mock;
  let setProjectCiVariablesFn: jest.Mock;
  let writeSecretsFn: jest.Mock;
  let deleteSecretsTreeFn: jest.Mock;
  let ensureNamespaceFn: jest.Mock;
  let getKubeconfigB64Fn: jest.Mock;
  let teardownProjectTargetsFn: jest.Mock;
  let hasReleaseInTargetsFn: jest.Mock;
  let tryDeleteProjectFn: jest.Mock;
  let getProjectFn: jest.Mock;
  let getFileContentFn: jest.Mock;
  let commitRepositoryActionsFn: jest.Mock;
  let hasSecretTreeFn: jest.Mock;
  let slugResolveFn: jest.Mock;
  let slugIsAvailableFn: jest.Mock;

  let gitlabService: jest.Mocked<GitLabService>;
  let vaultService: jest.Mocked<VaultService>;
  let k8sService: jest.Mocked<K8sService>;
  let slugService: jest.Mocked<SlugService>;
  let sonarQubeService: jest.Mocked<SonarQubeService>;
  let ensureSonarProjectFn: jest.Mock;
  let generateGlobalAnalysisTokenFn: jest.Mock;
  let readSecretsFn: jest.Mock;

  beforeEach(() => {
    projectModel = createMockModel();
    auditLogModel = createMockAuditModel();

    createGroupHierarchyFn = jest.fn().mockResolvedValue(5);
    forkTemplateFn = jest.fn().mockResolvedValue(forkedProject);
    createNewProjectFn = jest.fn().mockResolvedValue(forkedProject);
    upsertFileFn = jest.fn().mockResolvedValue(undefined);
    triggerPipelineFn = jest.fn().mockResolvedValue(undefined);
    listProjectsFn = jest.fn().mockResolvedValue([]);
    deleteProjectFn = jest.fn().mockResolvedValue(undefined);
    setProjectCiVariablesFn = jest.fn().mockResolvedValue(undefined);
    writeSecretsFn = jest.fn().mockResolvedValue(undefined);
    deleteSecretsTreeFn = jest.fn().mockResolvedValue({ deleted: 4, errors: [] });
    ensureNamespaceFn = jest.fn().mockResolvedValue(undefined);
    getKubeconfigB64Fn = jest.fn().mockReturnValue('base64-kubeconfig');
    teardownProjectTargetsFn = jest.fn().mockResolvedValue(undefined);
    hasReleaseInTargetsFn = jest.fn().mockResolvedValue(false);
    tryDeleteProjectFn = jest.fn().mockResolvedValue({ ok: true });
    getProjectFn = jest
      .fn()
      .mockResolvedValue(gitlabProjectFactory({ id: 42, default_branch: 'main' }));
    getFileContentFn = jest.fn().mockResolvedValue(null);
    commitRepositoryActionsFn = jest.fn().mockResolvedValue(undefined);
    hasSecretTreeFn = jest.fn().mockResolvedValue(false);
    slugResolveFn = jest.fn().mockImplementation((requested: string) => Promise.resolve(requested));
    slugIsAvailableFn = jest.fn().mockResolvedValue(true);

    gitlabService = {
      createGroupHierarchy: createGroupHierarchyFn,
      forkTemplate: forkTemplateFn,
      createNewProject: createNewProjectFn,
      upsertFile: upsertFileFn,
      getFileContent: getFileContentFn,
      commitRepositoryActions: commitRepositoryActionsFn,
      triggerPipeline: triggerPipelineFn,
      listProjects: listProjectsFn,
      deleteProject: deleteProjectFn,
      tryDeleteProject: tryDeleteProjectFn,
      getProject: getProjectFn,
      setProjectCiVariables: setProjectCiVariablesFn,
      templateGroup: 10,
      configGroup: 20,
    } as unknown as jest.Mocked<GitLabService>;

    readSecretsFn = jest.fn().mockResolvedValue({});
    vaultService = {
      writeSecrets: writeSecretsFn,
      readSecrets: readSecretsFn,
      deleteSecretsTree: deleteSecretsTreeFn,
      hasSecretTree: hasSecretTreeFn,
    } as unknown as jest.Mocked<VaultService>;

    k8sService = {
      ensureNamespace: ensureNamespaceFn,
      getKubeconfigB64: getKubeconfigB64Fn,
      teardownProjectTargets: teardownProjectTargetsFn,
      hasReleaseInTargets: hasReleaseInTargetsFn,
    } as unknown as jest.Mocked<K8sService>;

    slugService = {
      resolve: slugResolveFn,
      isAvailable: slugIsAvailableFn,
    } as unknown as jest.Mocked<SlugService>;

    ensureSonarProjectFn = jest
      .fn()
      .mockResolvedValue({ projectKey: 'clients-acme-repo_main', created: true });
    generateGlobalAnalysisTokenFn = jest.fn().mockResolvedValue('sqp_generated');
    sonarQubeService = {
      ensureProject: ensureSonarProjectFn,
      deleteProject: jest.fn().mockResolvedValue(undefined),
      generateGlobalAnalysisToken: generateGlobalAnalysisTokenFn,
      isConfigured: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<SonarQubeService>;

    service = new ProjectsService(
      projectModel as never,
      auditLogModel as never,
      gitlabService,
      vaultService,
      k8sService,
      slugService,
      sonarQubeService,
      createMockConfigService(),
    );
  });

  // ---------------------------------------------------------------------------
  // createProject
  // ---------------------------------------------------------------------------

  describe('createProject', () => {
    const baseInput: CreateProjectInput = {
      groupPath: ['groupa', 'groupab'],
      projectSlug: 'repoa',
      provisioning: Provisioning.AUTO_DEVOPS,
    };

    it('should create group hierarchy, GitLab project, vault secrets, and persist to Mongo', async () => {
      await service.createProject(baseInput);

      expect(createGroupHierarchyFn).toHaveBeenCalledWith(['groupa', 'groupab']);
      // displayName defaults to title-case when not provided (T7-N2: "repoa" → "Repoa")
      expect(createNewProjectFn).toHaveBeenCalledWith(5, 'repoa', 'Repoa', true);
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa',
        expect.objectContaining({ PROJECT_SLUG: 'repoa', EFFECTIVE_SLUG: 'repoa' }),
      );
      // F2: per-env sentinel paths are always written, even without envScopedVars
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/dev',
        expect.objectContaining({
          DEPLOY_ENV: 'dev',
          VAULT_PROJECT_PATH: 'projects/groupa/groupab/repoa',
        }),
      );
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/stg',
        expect.objectContaining({
          DEPLOY_ENV: 'stg',
          VAULT_PROJECT_PATH: 'projects/groupa/groupab/repoa',
        }),
      );
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/prod',
        expect.objectContaining({
          DEPLOY_ENV: 'prod',
          VAULT_PROJECT_PATH: 'projects/groupa/groupab/repoa',
        }),
      );
      expect(ensureNamespaceFn).toHaveBeenCalledTimes(3); // dev, stg, prod
      expect(projectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          gitlabPath: 'groupa/groupab/repoa',
          effectiveSlug: 'repoa',
          hostnameOverrides: {},
          legacyV1: false,
        }),
      );
    });

    it('should write .gitlab-ci.yml and chart-values.yaml for auto-devops', async () => {
      await service.createProject(baseInput);

      // .gitlab-ci.yml includes the pipeline template path from config (T5)
      expect(upsertFileFn).toHaveBeenCalledWith(
        42,
        '.gitlab-ci.yml',
        expect.stringContaining('auto-devops-pipeline'),
        expect.any(String),
      );
      // chart-values.yaml is a comment-only override file (T4 Option A)
      expect(upsertFileFn).toHaveBeenCalledWith(
        42,
        'chart-values.yaml',
        expect.stringContaining('dsoaas-app Helm chart'),
        expect.any(String),
      );
    });

    it('should write per-env Vault secrets with caller values merged on top of sentinels when envScopedVars is provided (T1+F2)', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        envScopedVars: {
          dev: JSON.stringify({ FEATURE_FLAG: 'on' }),
          prod: JSON.stringify({ FEATURE_FLAG: 'off' }),
        },
      };

      await service.createProject(input);

      // Base path still written
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa',
        expect.objectContaining({ PROJECT_SLUG: 'repoa' }),
      );
      // dev — sentinel keys present + caller value merged
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/dev',
        expect.objectContaining({ DEPLOY_ENV: 'dev', FEATURE_FLAG: 'on' }),
      );
      // stg — no caller value; sentinels only
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/stg',
        expect.objectContaining({ DEPLOY_ENV: 'stg' }),
      );
      // prod — sentinel keys present + caller value merged
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/prod',
        expect.objectContaining({ DEPLOY_ENV: 'prod', FEATURE_FLAG: 'off' }),
      );
    });

    it('should fall back to sentinels only for invalid JSON envScopedVars (T1+F2)', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        envScopedVars: { dev: 'not-json', stg: JSON.stringify({ KEY: 'val' }) },
      };

      await service.createProject(input);

      // dev — invalid JSON: sentinels written, caller value silently dropped
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/dev',
        expect.objectContaining({
          DEPLOY_ENV: 'dev',
          VAULT_PROJECT_PATH: 'projects/groupa/groupab/repoa',
        }),
      );
      // stg — valid JSON merged on top of sentinels
      expect(writeSecretsFn).toHaveBeenCalledWith(
        'projects/groupa/groupab/repoa/stg',
        expect.objectContaining({ KEY: 'val', DEPLOY_ENV: 'stg' }),
      );
    });

    it('should record envScopedVars envs in audit log metadata (T1)', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        envScopedVars: { dev: JSON.stringify({ FOO: 'bar' }) },
      };

      await service.createProject(input);

      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'project.created',
          metadata: expect.objectContaining({ envScopedVars: ['dev'] }),
        }),
      );
    });

    it('should use slugOverride instead of hostnameOverride for slug resolution (T2)', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        slugOverride: 'my-custom-slug',
      };

      await service.createProject(input);

      expect(slugResolveFn).toHaveBeenCalledWith('repoa', ['groupa', 'groupab'], 'my-custom-slug');
    });

    it('should persist hostnameOverrides as empty object at create time (T2)', async () => {
      await service.createProject(baseInput);

      expect(projectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ hostnameOverrides: {} }),
      );
    });

    it('should derive displayName from slug when not provided (T7-N2)', async () => {
      await service.createProject({ ...baseInput, projectSlug: 'my-app' });

      expect(createNewProjectFn).toHaveBeenCalledWith(5, 'my-app', 'My App', true);
    });

    it('should set env-scoped CI variables for deployable projects', async () => {
      await service.createProject(baseInput);

      expect(setProjectCiVariablesFn).toHaveBeenCalledWith(
        42,
        expect.arrayContaining([
          expect.objectContaining({
            key: 'KUBE_NAMESPACE',
            value: 'dev',
            environmentScope: 'dev-repoa',
          }),
          expect.objectContaining({
            key: 'APP_HOST',
            value: 'repoa.dev.apps.test.net',
            environmentScope: 'dev-repoa',
          }),
          expect.objectContaining({
            key: 'VAULT_PROJECT_PATH',
            environmentScope: 'dev-repoa',
          }),
          expect.objectContaining({
            key: 'HELM_RELEASE_NAME',
            value: 'repoa',
            environmentScope: 'dev-repoa',
          }),
          expect.objectContaining({
            key: 'EXTRA_HELM_ARGS',
            environmentScope: 'dev-repoa',
          }),
          expect.objectContaining({ key: 'KUBECONFIG_B64', environmentScope: 'dev-repoa' }),
        ]),
      );
    });

    it('should fork template when provisioning=TEMPLATE', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        provisioning: Provisioning.TEMPLATE,
        templateSlug: 'nestjs-app',
      };

      await service.createProject(input);

      expect(forkTemplateFn).toHaveBeenCalledWith('nestjs-app', 5, 'repoa');
      expect(createNewProjectFn).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when TEMPLATE provisioning has no templateSlug', async () => {
      await expect(
        service.createProject({ ...baseInput, provisioning: Provisioning.TEMPLATE }),
      ).rejects.toThrow(ConflictException);
    });

    it('should skip CI vars when capabilities.deployable=false', async () => {
      const input: CreateProjectInput = {
        ...baseInput,
        capabilities: { deployable: false, publishable: false },
      };

      await service.createProject(input);

      expect(setProjectCiVariablesFn).not.toHaveBeenCalled();
    });

    it('should write audit log entry on success', async () => {
      await service.createProject(baseInput);

      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'project.created' }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findProject
  // ---------------------------------------------------------------------------

  describe('findProject', () => {
    it('should find by MongoDB id', async () => {
      const mockDoc = { _id: 'abc', effectiveSlug: 'repoa', save: jest.fn(), deleteOne: jest.fn() };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.findProject({ id: 'abc' });

      expect(result.effectiveSlug).toBe('repoa');
    });

    it('should throw NotFoundException when project not found', async () => {
      await expect(service.findProject({ id: 'not-exist' })).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteProject
  // ---------------------------------------------------------------------------

  describe('deleteProject', () => {
    beforeEach(() => {
      tryDeleteProjectFn.mockResolvedValue({ ok: true });
      getProjectFn.mockRejectedValue({ response: { status: 404 } });
      hasSecretTreeFn.mockResolvedValue(false);
      hasReleaseInTargetsFn.mockResolvedValue(false);
    });

    it('should delete GitLab project and remove MongoDB document', async () => {
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        helmReleaseName: 'repoa',
        vaultBasePath: 'projects/groupa/repoa',
        capabilities: { deployable: true, publishable: false },
        save: jest.fn(),
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.deleteProject('abc');

      expect(teardownProjectTargetsFn).toHaveBeenCalledWith('repoa', expect.any(Array));
      expect(tryDeleteProjectFn).toHaveBeenCalledWith(42, { force: false });
      expect(deleteSecretsTreeFn).toHaveBeenCalledWith('projects/groupa/repoa');
      expect(mockDoc.deleteOne).toHaveBeenCalled();
      expect(result.outcome).toBe('deleted');
    });

    it('should archive when GitLab delete fails and GitLab project still exists', async () => {
      tryDeleteProjectFn.mockResolvedValueOnce({ ok: false, message: 'registry in use' });
      getProjectFn.mockResolvedValueOnce(gitlabProjectFactory({ id: 42 }));
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        helmReleaseName: 'repoa',
        vaultBasePath: 'projects/groupa/repoa',
        capabilities: { deployable: false, publishable: false },
        archived: false,
        save: jest.fn().mockResolvedValue(undefined),
        deleteOne: jest.fn(),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.deleteProject('abc');

      expect(result.outcome).toBe('archived');
      expect(mockDoc.archived).toBe(true);
      expect(mockDoc.archiveReason).toBe('resources_remaining');
      expect(mockDoc.save).toHaveBeenCalled();
      expect(mockDoc.deleteOne).not.toHaveBeenCalled();
    });

    it('should remove MongoDB row when GitLab delete fails but no resources remain', async () => {
      tryDeleteProjectFn.mockResolvedValueOnce({
        ok: false,
        message: 'Rename Not Supported',
      });
      getProjectFn.mockRejectedValueOnce({ response: { status: 404 } });
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        helmReleaseName: 'repoa',
        vaultBasePath: 'projects/groupa/repoa',
        capabilities: { deployable: true, publishable: false },
        archived: false,
        save: jest.fn(),
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.deleteProject('abc');

      expect(result.outcome).toBe('deleted');
      expect(hasReleaseInTargetsFn).toHaveBeenCalled();
      expect(hasSecretTreeFn).toHaveBeenCalledWith('projects/groupa/repoa');
      expect(mockDoc.deleteOne).toHaveBeenCalled();
      expect(mockDoc.save).not.toHaveBeenCalled();
    });

    it('should purge registry when forceGitLabDelete is set', async () => {
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        helmReleaseName: 'repoa',
        vaultBasePath: 'projects/groupa/repoa',
        capabilities: { deployable: false, publishable: false },
        archived: true,
        save: jest.fn(),
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.deleteProject('abc', { forceGitLabDelete: true });

      expect(tryDeleteProjectFn).toHaveBeenCalledWith(42, { force: true });
      expect(teardownProjectTargetsFn).not.toHaveBeenCalled();
      expect(result.outcome).toBe('deleted');
    });

    it('should continue when Vault deletion fails (non-critical)', async () => {
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        helmReleaseName: 'repoa',
        vaultBasePath: 'projects/groupa/repoa',
        capabilities: { deployable: false, publishable: false },
        save: jest.fn(),
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });
      deleteSecretsTreeFn.mockRejectedValueOnce(new Error('Vault error'));

      const result = await service.deleteProject('abc');

      expect(result.outcome).toBe('deleted');
      expect(tryDeleteProjectFn).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // provisionSonarProjects
  // ---------------------------------------------------------------------------

  describe('provisionSonarProjects', () => {
    it('should create Sonar projects and sync allowed branches', async () => {
      const saveFn = jest.fn().mockResolvedValue(undefined);
      const mockDoc = {
        _id: 'abc',
        gitlabProjectId: 42,
        gitlabPath: 'clients/acme/repo',
        projectSlug: 'repo',
        displayName: 'Repo',
        effectiveSlug: 'repo',
        vaultBasePath: 'projects/clients/acme/repo',
        sonar: undefined,
        save: saveFn,
        deleteOne: jest.fn(),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });
      ensureSonarProjectFn.mockResolvedValue({
        projectKey: 'clients-acme-repo_main',
        created: true,
      });

      const results = await service.provisionSonarProjects('abc', ['main', 'staging']);

      expect(results).toHaveLength(2);
      expect(ensureSonarProjectFn).toHaveBeenCalledTimes(2);
      expect(saveFn).toHaveBeenCalled();
      expect(generateGlobalAnalysisTokenFn).toHaveBeenCalled();
      expect(writeSecretsFn).toHaveBeenCalledWith('projects/clients/acme/repo/sonar', {
        SONAR_TOKEN: 'sqp_generated',
      });
      expect(setProjectCiVariablesFn).toHaveBeenCalled();
      expect(mockDoc.sonar?.allowedBranches).toEqual(expect.arrayContaining(['main', 'staging']));
    });
  });

  // ---------------------------------------------------------------------------
  // setPinnedV1
  // ---------------------------------------------------------------------------

  describe('setPinnedV1', () => {
    it('should update pinnedV1 flag and save', async () => {
      const saveFn = jest.fn().mockResolvedValue(undefined);
      const mockDoc = {
        _id: 'abc',
        gitlabPath: 'groupa/repoa',
        effectiveSlug: 'repoa',
        pinnedV1: false,
        save: saveFn,
        deleteOne: jest.fn(),
      };
      projectModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(mockDoc) });

      const result = await service.setPinnedV1('abc', true);

      expect(saveFn).toHaveBeenCalled();
      expect(result.pinnedV1).toBe(true);
    });
  });
});
