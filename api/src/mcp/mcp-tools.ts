import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

import { ConfigsService } from '../configs/configs.service';
import { EnvProfileService } from '../projects/env/env-profile.service';
import type {
  CreateProjectInput,
  RegisterGitLabProjectInput,
  UpsertDeploymentTargetInput,
} from '../projects/graphql/project.inputs';
import type { ClusterProfile, Provisioning, SonarGateMode } from '../projects/graphql/enums';
import { ProjectsService } from '../projects/projects.service';
import type { EnvProfile, ProjectDocument } from '../projects/schemas/project.schema';
import { SlugService } from '../projects/slug.service';
import { TemplatesService } from '../templates/templates.service';
import { VaultService } from '../vault/vault.service';
import { scopeAllows, type McpScope } from './mcp-scopes';

export interface McpToolDefinition {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: Record<string, unknown>;
}

const LIMIT = { type: 'integer', minimum: 1, maximum: 100 };

export function toolsForScope(scope: McpScope): Omit<McpToolDefinition, 'scope'>[] {
  return MCP_TOOLS.filter((tool) => scopeAllows(scope, tool.scope)).map(
    ({ scope: _scope, ...tool }) => tool,
  );
}

export function toolScope(name: string): McpScope | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name)?.scope;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'platform_health',
    scope: 'read',
    description:
      'Mongo and Vault reachability only. status=ok does not mean GitLab, Kubernetes, Keycloak, or SonarQube are up.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_projects',
    scope: 'read',
    description:
      'List registry projects. Does not include secret values. At most 100 rows. Archived projects are omitted unless archived=true.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Case-insensitive match on path, slug, or display name',
        },
        groupPrefix: {
          type: 'string',
          description: 'GitLab group path prefix, for example internal/qestor',
        },
        archived: { type: 'boolean' },
        legacyOnly: { type: 'boolean' },
        pinnedOnly: { type: 'boolean' },
        limit: LIMIT,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_project',
    scope: 'read',
    description:
      'One project by Mongo id, GitLab path, or effective slug. Env profiles include key names only, never values.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        gitlabPath: { type: 'string' },
        slug: { type: 'string', description: 'effectiveSlug' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_audit_logs',
    scope: 'read',
    description: 'Recent lifecycle audit events. No secret values are stored.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        limit: LIMIT,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_env_profile_content',
    scope: 'read_secret',
    description:
      'Vault secret body for one env profile. Reveals values. Requires read_secret or higher. Audited as env.profile.revealed.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        profileId: { type: 'string' },
      },
      required: ['projectId', 'profileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_hostname',
    scope: 'operate',
    description:
      'Safe write. Sets apps[0].host for a deployment target (including dev, stg, and prod) and updates APP_HOST CI. This is the hostname override. It does not delete anything.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Mongo project id' },
        targetKey: { type: 'string', description: 'dev, stg, prod, or a custom target key' },
        hostname: { type: 'string' },
      },
      required: ['id', 'targetKey', 'hostname'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_pinned',
    scope: 'operate',
    description: 'Safe write. Sets or clears pinnedV1 so a legacy project stays on or leaves v1.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['id', 'pinned'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_env_profile_content',
    scope: 'operate',
    description:
      'Safe write. Replaces one env profile secret body in Vault. Does not delete the profile.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        profileId: { type: 'string' },
        content: { type: 'string', description: 'Full dotenv or raw file replacement' },
      },
      required: ['projectId', 'profileId', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_env_profile_metadata',
    scope: 'operate',
    description:
      'Safe write. Updates label, branches, or runtime targets. Does not replace secret values unless target membership changes a RUNTIME profile.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        profileId: { type: 'string' },
        label: { type: 'string' },
        branches: {
          description: 'Branch names as a string array or a comma-separated string',
        },
        deploymentTargetKeys: {
          description: 'Target keys as a string array or a comma-separated string',
        },
        jobSelector: { type: 'string' },
        workspacePath: { type: 'string' },
        filename: { type: 'string' },
        contentType: { type: 'string' },
      },
      required: ['projectId', 'profileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_env_profile',
    scope: 'full',
    description: 'Destructive. Deletes an env profile from the registry and Vault.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        profileId: { type: 'string' },
      },
      required: ['projectId', 'profileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_deployment_target',
    scope: 'full',
    description:
      'Destructive. Removes a deployment target and tears down its Kubernetes releases by default.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        targetKey: { type: 'string' },
        teardownK8s: { type: 'boolean', description: 'Default true' },
      },
      required: ['id', 'targetKey'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_project',
    scope: 'full',
    description:
      'Destructive. Tears down Kubernetes, Vault, and Sonar, then deletes GitLab. Archives the row when something remains.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        forceGitLabDelete: { type: 'boolean' },
        skipPlatformCleanup: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'slug_available',
    scope: 'read',
    description: 'True when the effective slug is not taken.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_templates',
    scope: 'read',
    description: 'Template repositories in the GitLab templates group.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_template',
    scope: 'read',
    description: 'One template, including its file tree. File contents are not included.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_configs',
    scope: 'read',
    description: 'Shared CI config repositories in the GitLab configs group.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_config',
    scope: 'read',
    description: 'One shared CI config, including its file tree. File contents are not included.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_env_profiles',
    scope: 'read',
    description: 'Env profile metadata for one project. Key names only, never values.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_project',
    scope: 'operate',
    description:
      'Provisions a project: GitLab groups, repo, Vault seed, CI variables, and the registry row. publishable defaults to false.',
    inputSchema: {
      type: 'object',
      properties: {
        groupPath: {
          type: 'array',
          items: { type: 'string' },
          description: 'Parent groups only. Omit the project slug.',
        },
        projectSlug: { type: 'string' },
        displayName: { type: 'string' },
        provisioning: { type: 'string', enum: ['auto-devops', 'template'] },
        templateSlug: { type: 'string' },
        deployable: { type: 'boolean' },
        publishable: { type: 'boolean' },
        envVars: { type: 'object', additionalProperties: { type: 'string' } },
        envScopedVars: { type: 'object' },
        slugOverride: { type: 'string' },
        sonar: { type: 'object' },
        deploymentTargets: { type: 'array', items: { type: 'object' } },
      },
      required: ['groupPath', 'projectSlug'],
      additionalProperties: false,
    },
  },
  {
    name: 'register_gitlab_project',
    scope: 'operate',
    description: 'Registers an existing GitLab project by numeric id.',
    inputSchema: {
      type: 'object',
      properties: {
        gitlabProjectId: { type: 'integer' },
        groupPath: { type: 'array', items: { type: 'string' } },
        projectSlug: { type: 'string' },
        displayName: { type: 'string' },
        provisioning: { type: 'string', enum: ['auto-devops', 'template'] },
        deployable: { type: 'boolean' },
        publishable: { type: 'boolean' },
        deploymentTargets: { type: 'array', items: { type: 'object' } },
        envVars: { type: 'object', additionalProperties: { type: 'string' } },
        envScopedVars: { type: 'object' },
        slugOverride: { type: 'string' },
        sonar: { type: 'object' },
        branchOptions: { type: 'object' },
      },
      required: ['gitlabProjectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_deployment_target',
    scope: 'operate',
    description:
      'Creates or updates one deployment target and its apps. Disabling can tear down Kubernetes when teardownK8sOnDisable is true (the default).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        targetKey: { type: 'string' },
        enabled: { type: 'boolean' },
        deployRef: { type: 'string' },
        appHost: { type: 'string' },
        kubeNamespace: { type: 'string' },
        clusterProfile: { type: 'string', enum: ['dev', 'stg', 'prod'] },
        teardownK8sOnDisable: { type: 'boolean' },
        apps: { type: 'array', items: { type: 'object' } },
      },
      required: ['id', 'targetKey', 'enabled', 'apps'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_env_profile',
    scope: 'operate',
    description:
      'Creates an env profile and stores its body in Vault. Does not delete an existing profile.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        label: { type: 'string' },
        injectionPhase: { type: 'string', enum: ['build', 'runtime'] },
        branches: { type: 'array', items: { type: 'string' } },
        content: { type: 'string' },
        deploymentTargetKeys: { type: 'array', items: { type: 'string' } },
        jobSelector: { type: 'string' },
        workspacePath: { type: 'string' },
        filename: { type: 'string' },
        buildDelivery: { type: 'string', enum: ['raw_file', 'dotenv_build_args'] },
        contentType: { type: 'string' },
      },
      required: ['projectId', 'label', 'injectionPhase', 'branches', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_sonar_config',
    scope: 'operate',
    description:
      'Sets the Sonar branch allowlist and optional gate policy. An empty allowlist disables Sonar. sonarToken is stored in Vault and is not returned.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        allowedBranches: {
          description: 'String array or comma-separated names. Empty disables Sonar.',
        },
        gatePolicy: { type: 'object' },
        sonarToken: { type: 'string' },
      },
      required: ['id', 'allowedBranches'],
      additionalProperties: false,
    },
  },
  {
    name: 'provision_sonar_projects',
    scope: 'operate',
    description: 'Creates Sonar analysis projects for the given branches. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        branches: { description: 'String array or comma-separated names' },
        addToAllowedBranches: { type: 'boolean', description: 'Default true' },
      },
      required: ['id', 'branches'],
      additionalProperties: false,
    },
  },
  {
    name: 'migrate_to_auto_devops',
    scope: 'operate',
    description:
      'Migrates a legacy v1 project onto the Auto DevOps pipeline. Refused while pinned unless unpin is true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        unpin: { type: 'boolean' },
        defaultBranch: { type: 'string' },
        devRef: { type: 'string' },
        stgRef: { type: 'string' },
        prodRef: { type: 'string' },
        useDefaultBranchForAllDeployTargets: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_template',
    scope: 'operate',
    description: 'Creates a template repository in the GitLab templates group.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        description: { type: 'string' },
        files: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_config',
    scope: 'operate',
    description: 'Creates a shared CI config repository.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        description: { type: 'string' },
        ciContent: { type: 'string' },
      },
      required: ['slug', 'ciContent'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_config_file',
    scope: 'operate',
    description: 'Commits one file in a shared CI config repository.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        filePath: { type: 'string' },
        content: { type: 'string' },
        commitMessage: { type: 'string' },
      },
      required: ['slug', 'filePath', 'content', 'commitMessage'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_sonar_projects',
    scope: 'full',
    description:
      'Deletes Sonar analysis projects for the given branches. pruneAllowlist defaults to true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        branches: { description: 'String array or comma-separated names' },
        pruneAllowlist: { type: 'boolean' },
      },
      required: ['id', 'branches'],
      additionalProperties: false,
    },
  },
  {
    name: 'reconcile_gitlab_projects',
    scope: 'full',
    description:
      'Backfills GitLab projects missing from the registry as legacy v1, and archives registry rows whose GitLab project is pending deletion.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'delete_template',
    scope: 'full',
    description: 'Permanently deletes a template repository from GitLab.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_config',
    scope: 'full',
    description: 'Permanently deletes a shared CI config repository from GitLab.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
];

@Injectable()
export class McpToolService {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly vault: VaultService,
    private readonly projects: ProjectsService,
    private readonly envProfiles: EnvProfileService,
    private readonly slugs: SlugService,
    private readonly templates: TemplatesService,
    private readonly configs: ConfigsService,
  ) {}

  async call(name: string, args: Record<string, unknown>, scope: McpScope): Promise<unknown> {
    const required = toolScope(name);
    if (!required) {
      throw new Error(`Unknown tool: ${name}`);
    }
    if (!scopeAllows(scope, required)) {
      throw new Error(`Insufficient MCP scope: ${name} requires ${required}`);
    }
    switch (name) {
      case 'platform_health':
        return this.health();
      case 'list_projects':
        return this.listProjects(args);
      case 'get_project':
        return this.getProject(args);
      case 'list_audit_logs':
        return this.listAudit(args);
      case 'get_env_profile_content':
        return this.envProfiles.getProfileContent(
          requiredString(args, 'projectId'),
          requiredString(args, 'profileId'),
        );
      case 'set_hostname':
        return summarizeProject(
          await this.projects.setDeploymentTargetHostname(
            requiredString(args, 'id'),
            requiredString(args, 'targetKey'),
            requiredString(args, 'hostname'),
          ),
        );
      case 'set_pinned':
        if (typeof args.pinned !== 'boolean') {
          throw new Error('pinned must be a boolean');
        }
        return summarizeProject(
          await this.projects.setPinnedV1(requiredString(args, 'id'), args.pinned),
        );
      case 'update_env_profile_content':
        return summarizeEnvProfile(
          await this.envProfiles.updateProfileContent(
            requiredString(args, 'projectId'),
            requiredString(args, 'profileId'),
            requiredString(args, 'content'),
          ),
        );
      case 'update_env_profile_metadata':
        return summarizeEnvProfile(
          await this.envProfiles.updateProfileMetadata(
            requiredString(args, 'projectId'),
            requiredString(args, 'profileId'),
            {
              label: optionalString(args, 'label'),
              branches: stringList(args.branches),
              deploymentTargetKeys: stringList(args.deploymentTargetKeys),
              jobSelector: optionalString(args, 'jobSelector'),
              workspacePath: optionalString(args, 'workspacePath'),
              filename: optionalString(args, 'filename'),
              contentType: optionalString(args, 'contentType'),
            },
          ),
        );
      case 'slug_available':
        return {
          slug: requiredString(args, 'slug'),
          available: await this.slugs.isAvailable(requiredString(args, 'slug')),
        };
      case 'list_templates':
        return this.templates.listTemplates();
      case 'get_template':
        return this.templates.getTemplate(requiredString(args, 'slug'));
      case 'list_configs':
        return this.configs.listConfigs();
      case 'get_config':
        return this.configs.getConfig(requiredString(args, 'slug'));
      case 'list_env_profiles':
        return (await this.envProfiles.listProfiles(requiredString(args, 'projectId'))).map(
          summarizeEnvProfile,
        );
      case 'create_project':
        return summarizeProject(await this.projects.createProject(parseCreateProject(args)));
      case 'register_gitlab_project':
        return summarizeProject(
          await this.projects.registerGitLabProject(parseRegisterProject(args)),
        );
      case 'upsert_deployment_target': {
        const result = await this.projects.upsertDeploymentTarget(
          requiredString(args, 'id'),
          parseUpsertTarget(args),
        );
        return { project: summarizeProject(result.doc), ciSyncWarnings: result.ciSyncWarnings };
      }
      case 'upload_env_profile':
        return summarizeEnvProfile(
          await this.envProfiles.uploadProfile(requiredString(args, 'projectId'), {
            label: requiredString(args, 'label'),
            injectionPhase: oneOf(args.injectionPhase, ['build', 'runtime'], 'injectionPhase'),
            branches: requiredStringList(args.branches, 'branches'),
            content: requiredString(args, 'content'),
            deploymentTargetKeys: stringList(args.deploymentTargetKeys),
            jobSelector: optionalString(args, 'jobSelector'),
            workspacePath: optionalString(args, 'workspacePath'),
            filename: optionalString(args, 'filename'),
            buildDelivery: optionalOneOf(
              args.buildDelivery,
              ['raw_file', 'dotenv_build_args'],
              'buildDelivery',
            ),
            contentType: optionalString(args, 'contentType'),
          }),
        );
      case 'update_sonar_config':
        return summarizeProject(
          await this.projects.updateProjectSonarConfig(requiredString(args, 'id'), {
            allowedBranches: presentStringList(args.allowedBranches, 'allowedBranches'),
            gatePolicy: parseGatePolicy(args.gatePolicy),
            sonarToken: optionalString(args, 'sonarToken'),
          }),
        );
      case 'provision_sonar_projects':
        return this.projects.provisionSonarProjects(
          requiredString(args, 'id'),
          requiredStringList(args.branches, 'branches'),
          args.addToAllowedBranches !== false,
        );
      case 'migrate_to_auto_devops':
        return summarizeProject(
          await this.projects.migrateProjectToAutoDevops(
            requiredString(args, 'id'),
            parseBranchOptions(args),
            args.unpin === true,
          ),
        );
      case 'create_template':
        return this.templates.createTemplate({
          slug: requiredString(args, 'slug'),
          description: optionalString(args, 'description'),
          files: stringMap(args.files, 'files'),
        });
      case 'create_config':
        return this.configs.createConfig({
          slug: requiredString(args, 'slug'),
          description: optionalString(args, 'description'),
          ciContent: requiredString(args, 'ciContent'),
        });
      case 'update_config_file':
        await this.configs.updateConfigFiles(requiredString(args, 'slug'), {
          filePath: requiredString(args, 'filePath'),
          content: requiredString(args, 'content'),
          commitMessage: requiredString(args, 'commitMessage'),
        });
        return { updated: true, slug: requiredString(args, 'slug') };
      case 'delete_sonar_projects':
        await this.projects.deleteSonarProjects(
          requiredString(args, 'id'),
          requiredStringList(args.branches, 'branches'),
          args.pruneAllowlist !== false,
        );
        return { deleted: true };
      case 'reconcile_gitlab_projects':
        return this.projects.reconcileGitLabProjects();
      case 'delete_template':
        await this.templates.deleteTemplate(requiredString(args, 'slug'));
        return { deleted: true, slug: requiredString(args, 'slug') };
      case 'delete_config':
        await this.configs.deleteConfig(requiredString(args, 'slug'));
        return { deleted: true, slug: requiredString(args, 'slug') };
      case 'delete_env_profile':
        return summarizeProject(
          await this.envProfiles.deleteProfile(
            requiredString(args, 'projectId'),
            requiredString(args, 'profileId'),
          ),
        );
      case 'remove_deployment_target':
        return summarizeProject(
          await this.projects.removeDeploymentTarget(
            requiredString(args, 'id'),
            requiredString(args, 'targetKey'),
            args.teardownK8s !== false,
          ),
        );
      case 'delete_project':
        return this.projects.deleteProject(requiredString(args, 'id'), {
          forceGitLabDelete: args.forceGitLabDelete === true,
          skipPlatformCleanup: args.skipPlatformCleanup === true,
        });
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async health() {
    const mongoOk = this.mongo.readyState === ConnectionStates.connected;
    const vaultOk = await this.vault.ping().catch(() => false);
    return {
      status: mongoOk && vaultOk ? 'ok' : 'degraded',
      mongo: mongoOk ? 'ok' : 'down',
      vault: vaultOk ? 'ok' : 'down',
      checks: 'mongo,vault',
      notChecked: 'gitlab,kubernetes,keycloak,sonarqube',
    };
  }

  private async listProjects(args: Record<string, unknown>) {
    const limit = clampLimit(args.limit, 50);
    const groupPrefix =
      typeof args.groupPrefix === 'string'
        ? args.groupPrefix.split('/').filter((part) => part.length > 0)
        : undefined;
    const rows = await this.projects.listProjects(
      {
        archived: args.archived === true,
        legacyV1: args.legacyOnly === true ? true : undefined,
        pinnedV1: args.pinnedOnly === true ? true : undefined,
        groupPathPrefix: groupPrefix,
      },
      0,
      100,
    );
    const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
    const filtered = search
      ? rows.filter((doc) => {
          const haystack =
            `${doc.gitlabPath} ${doc.effectiveSlug} ${doc.displayName ?? ''}`.toLowerCase();
          return haystack.includes(search);
        })
      : rows;
    return {
      returned: Math.min(filtered.length, limit),
      projects: filtered.slice(0, limit).map(summarizeProject),
    };
  }

  private async getProject(args: Record<string, unknown>) {
    const id = typeof args.id === 'string' ? args.id : undefined;
    const gitlabPath = typeof args.gitlabPath === 'string' ? args.gitlabPath : undefined;
    const slug = typeof args.slug === 'string' ? args.slug : undefined;
    const provided = [id, gitlabPath, slug].filter(Boolean);
    if (provided.length !== 1) {
      throw new Error('Provide exactly one of id, gitlabPath, or slug');
    }
    const doc = await this.projects.findProject({ id, gitlabPath, effectiveSlug: slug });
    return summarizeProject(doc);
  }

  private async listAudit(args: Record<string, unknown>) {
    const projectId = typeof args.projectId === 'string' ? args.projectId : undefined;
    const rows = await this.projects.listAuditLogs(projectId, clampLimit(args.limit, 50));
    return rows.map((row) => ({
      id: String(row._id),
      eventType: row.eventType,
      actor: row.actor,
      projectId: row.projectId,
      gitlabPath: row.gitlabPath,
      effectiveSlug: row.effectiveSlug,
      metadata: row.metadata,
      createdAt: row.createdAt?.toISOString(),
    }));
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function clampLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

function summarizeProject(doc: ProjectDocument) {
  return {
    id: String(doc._id),
    gitlabProjectId: doc.gitlabProjectId,
    gitlabPath: doc.gitlabPath,
    effectiveSlug: doc.effectiveSlug,
    displayName: doc.displayName,
    provisioning: doc.provisioning,
    archived: Boolean(doc.archived),
    archiveReason: doc.archiveReason,
    gitlabDeleteError: doc.gitlabDeleteError,
    legacyV1: Boolean(doc.legacyV1),
    pinnedV1: Boolean(doc.pinnedV1),
    capabilities: doc.capabilities,
    deploymentTargets: (doc.deploymentTargets ?? []).map((target) => ({
      key: target.key,
      hosts: (target.apps ?? []).map((app) => app.host).filter(Boolean),
      appHost: target.appHost,
      deployRef: target.deployRef,
      enabled: target.enabled,
      kubeNamespace: target.kubeNamespace,
    })),
    envProfiles: (doc.envProfiles ?? []).map((profile) => ({
      id: profile.id,
      label: profile.label,
      injectionPhase: profile.injectionPhase,
      branches: profile.branches,
      keyNames: profile.keyNames ?? [],
    })),
    sonar: doc.sonar
      ? {
          allowedBranches: doc.sonar.allowedBranches,
          gatePolicy: doc.sonar.gatePolicy,
        }
      : undefined,
  };
}

function summarizeEnvProfile(profile: EnvProfile) {
  return {
    id: profile.id,
    label: profile.label,
    injectionPhase: profile.injectionPhase,
    branches: profile.branches,
    deploymentTargetKeys: profile.deploymentTargetKeys,
    jobSelector: profile.jobSelector,
    workspacePath: profile.workspacePath,
    filename: profile.filename,
    buildDelivery: profile.buildDelivery,
    contentType: profile.contentType,
    keyNames: profile.keyNames ?? [],
    updatedAt:
      profile.updatedAt instanceof Date ? profile.updatedAt.toISOString() : profile.updatedAt,
  };
}

function asObject(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new Error(`expected a non-empty string at index ${index}`);
      }
      return item.trim();
    });
  }
  if (typeof value === 'string') {
    return csv(value);
  }
  throw new Error('expected a string array or a comma-separated string');
}

function requiredStringList(value: unknown, key: string): string[] {
  const list = stringList(value);
  if (!list || list.length === 0) {
    throw new Error(`${key} is required`);
  }
  return list;
}

function presentStringList(value: unknown, key: string): string[] {
  if (value === undefined || value === null) {
    throw new Error(`${key} is required`);
  }
  return stringList(value) ?? [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  key: string,
): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return oneOf(value, allowed, key);
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function requiredInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function stringMap(value: unknown, key: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const row = asObject(value, key);
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(row)) {
    if (typeof item !== 'string') {
      throw new Error(`${key}.${name} must be a string`);
    }
    out[name] = item;
  }
  return out;
}

function scopedVar(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  throw new Error(`${key} must be a JSON string or object`);
}

function parseEnvScoped(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  const row = asObject(value, 'envScopedVars');
  return {
    dev: scopedVar(row.dev, 'envScopedVars.dev'),
    stg: scopedVar(row.stg, 'envScopedVars.stg'),
    prod: scopedVar(row.prod, 'envScopedVars.prod'),
  };
}

function parseGatePolicy(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  const row = asObject(value, 'gatePolicy');
  const modes = ['optional', 'required'] as const;
  return {
    dev: optionalOneOf(row.dev, modes, 'gatePolicy.dev') as SonarGateMode | undefined,
    stg: optionalOneOf(row.stg, modes, 'gatePolicy.stg') as SonarGateMode | undefined,
    prod: optionalOneOf(row.prod, modes, 'gatePolicy.prod') as SonarGateMode | undefined,
    other: optionalOneOf(row.other, modes, 'gatePolicy.other') as SonarGateMode | undefined,
  };
}

function parseSonar(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  const row = asObject(value, 'sonar');
  if (row.allowedBranches === undefined) {
    throw new Error('sonar.allowedBranches is required');
  }
  return {
    allowedBranches: presentStringList(row.allowedBranches, 'sonar.allowedBranches'),
    gatePolicy: parseGatePolicy(row.gatePolicy),
    sonarToken: optionalString(row, 'sonarToken'),
  };
}

function parseApps(value: unknown, required: boolean) {
  if (value === undefined) {
    if (required) {
      throw new Error('apps is required');
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('apps must be a non-empty array');
  }
  return value.map((item, index) => {
    const row = asObject(item, `apps[${index}]`);
    return {
      name: requiredString(row, 'name'),
      image: requiredString(row, 'image'),
      dockerfile: optionalString(row, 'dockerfile'),
      host: optionalString(row, 'host'),
    };
  });
}

function parseTargets(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('deploymentTargets must be an array');
  }
  return value.map((item, index) => {
    const row = asObject(item, `deploymentTargets[${index}]`);
    return {
      key: requiredString(row, 'key'),
      kubeNamespace: optionalString(row, 'kubeNamespace'),
      clusterProfile: optionalOneOf(
        row.clusterProfile,
        ['dev', 'stg', 'prod'],
        'clusterProfile',
      ) as ClusterProfile | undefined,
      appHost: optionalString(row, 'appHost'),
      deployRef: optionalString(row, 'deployRef'),
      enabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
      apps: parseApps(row.apps, false),
    };
  });
}

function parseCapabilities(args: Record<string, unknown>) {
  const deployable = optionalBoolean(args, 'deployable');
  const publishable = optionalBoolean(args, 'publishable');
  if (deployable === undefined && publishable === undefined) {
    return undefined;
  }
  return { deployable, publishable };
}

function parseCreateProject(args: Record<string, unknown>): CreateProjectInput {
  return {
    groupPath: requiredStringList(args.groupPath, 'groupPath'),
    projectSlug: requiredString(args, 'projectSlug'),
    displayName: optionalString(args, 'displayName'),
    provisioning: optionalOneOf(args.provisioning, ['auto-devops', 'template'], 'provisioning') as
      | Provisioning
      | undefined,
    templateSlug: optionalString(args, 'templateSlug'),
    capabilities: parseCapabilities(args),
    envVars: stringMap(args.envVars, 'envVars'),
    envScopedVars: parseEnvScoped(args.envScopedVars),
    slugOverride: optionalString(args, 'slugOverride'),
    sonar: parseSonar(args.sonar),
    deploymentTargets: parseTargets(args.deploymentTargets),
  };
}

function parseBranchOptions(args: Record<string, unknown>) {
  const defaultBranch = optionalString(args, 'defaultBranch');
  const dev = optionalString(args, 'devRef');
  const stg = optionalString(args, 'stgRef');
  const prod = optionalString(args, 'prodRef');
  const useDefault = args.useDefaultBranchForAllDeployTargets === true ? true : undefined;
  if (!defaultBranch && !dev && !stg && !prod && useDefault === undefined) {
    return undefined;
  }
  return {
    defaultBranch,
    deployRefs: dev || stg || prod ? { dev, stg, prod } : undefined,
    useDefaultBranchForAllDeployTargets: useDefault,
  };
}

function parseRegisterProject(args: Record<string, unknown>): RegisterGitLabProjectInput {
  return {
    gitlabProjectId: requiredInt(args, 'gitlabProjectId'),
    groupPath: stringList(args.groupPath),
    projectSlug: optionalString(args, 'projectSlug'),
    displayName: optionalString(args, 'displayName'),
    provisioning: optionalOneOf(args.provisioning, ['auto-devops', 'template'], 'provisioning') as
      | Provisioning
      | undefined,
    capabilities: parseCapabilities(args),
    deploymentTargets: parseTargets(args.deploymentTargets),
    envVars: stringMap(args.envVars, 'envVars'),
    envScopedVars: parseEnvScoped(args.envScopedVars),
    slugOverride: optionalString(args, 'slugOverride'),
    sonar: parseSonar(args.sonar),
    branchOptions: parseBranchOptions(args),
  };
}

function parseUpsertTarget(args: Record<string, unknown>): UpsertDeploymentTargetInput {
  if (typeof args.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  return {
    targetKey: requiredString(args, 'targetKey'),
    enabled: args.enabled,
    deployRef: optionalString(args, 'deployRef'),
    appHost: optionalString(args, 'appHost'),
    kubeNamespace: optionalString(args, 'kubeNamespace'),
    clusterProfile: optionalOneOf(args.clusterProfile, ['dev', 'stg', 'prod'], 'clusterProfile') as
      | ClusterProfile
      | undefined,
    teardownK8sOnDisable:
      typeof args.teardownK8sOnDisable === 'boolean' ? args.teardownK8sOnDisable : true,
    apps: parseApps(args.apps, true) ?? [],
  };
}
