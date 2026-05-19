/** Shared GraphQL field selections — keep in sync with api/src/projects/graphql. */

export const PROJECT_FIELDS = `
  id
  gitlabProjectId
  gitlabPath
  groupPath
  projectSlug
  effectiveSlug
  displayName
  provisioning
  templateSlug
  vaultBasePath
  helmReleaseName
  appHosts { dev stg prod }
  deploymentTargets {
    key
    kubeNamespace
    clusterProfile
    appHost
    deployRef
    enabled
    gitlabEnvironment
  }
  capabilities { deployable publishable }
  envProfiles {
    id
    label
    injectionPhase
    branches
    deploymentTargetKeys
    jobSelector
    workspacePath
    filename
    buildDelivery
    vaultPath
    contentType
    keyNames
    updatedAt
  }
  runtimeEnvEnabled
  sonar {
    allowedBranches
    gatePolicy { dev stg prod other }
    dashboardUrl
  }
  legacyV1
  pinnedV1
  archived
  archivedAt
  archiveReason
  gitlabDeleteError
  createdAt
  updatedAt
`;

export const SONAR_PROVISION_FIELDS = `
  branch
  projectKey
  projectName
  created
  dashboardUrl
`;

export const QUERIES = {
  projects: `
    query Projects($page: Int, $perPage: Int, $filter: ProjectFilterInput) {
      projects(page: $page, perPage: $perPage, filter: $filter) {
        ${PROJECT_FIELDS}
      }
    }
  `,
  project: `
    query Project($id: ID, $gitlabPath: String, $effectiveSlug: String) {
      project(id: $id, gitlabPath: $gitlabPath, effectiveSlug: $effectiveSlug) {
        ${PROJECT_FIELDS}
      }
    }
  `,
  slugAvailable: `
    query SlugAvailable($slug: String!) {
      slugAvailable(slug: $slug)
    }
  `,
  templates: `
    query Templates {
      templates { id slug description gitlabUrl defaultBranch }
    }
  `,
} as const;

export const MUTATIONS = {
  createProject: `
    mutation CreateProject($input: CreateProjectInput!) {
      createProject(input: $input) { ${PROJECT_FIELDS} }
    }
  `,
  registerGitLabProject: `
    mutation RegisterGitLabProject($input: RegisterGitLabProjectInput!) {
      registerGitLabProject(input: $input) { ${PROJECT_FIELDS} }
    }
  `,
  reconcileGitLabProjects: `
    mutation ReconcileGitLabProjects {
      reconcileGitLabProjects {
        backfilled
        archivedFromRegistry
        backfilledGitlabPaths
        message
      }
    }
  `,
  upsertDeploymentTarget: `
    mutation UpsertDeploymentTarget($id: ID!, $input: UpsertDeploymentTargetInput!) {
      upsertDeploymentTarget(id: $id, input: $input) { ${PROJECT_FIELDS} }
    }
  `,
  removeDeploymentTarget: `
    mutation RemoveDeploymentTarget($id: ID!, $targetKey: String!, $teardownK8s: Boolean) {
      removeDeploymentTarget(id: $id, targetKey: $targetKey, teardownK8s: $teardownK8s) {
        ${PROJECT_FIELDS}
      }
    }
  `,
  setDeploymentTargetHostname: `
    mutation SetDeploymentTargetHostname($id: ID!, $targetKey: String!, $hostname: String!) {
      setDeploymentTargetHostname(id: $id, targetKey: $targetKey, hostname: $hostname) {
        ${PROJECT_FIELDS}
      }
    }
  `,
  deleteProject: `
    mutation DeleteProject($id: ID!, $forceGitLabDelete: Boolean) {
      deleteProject(id: $id, forceGitLabDelete: $forceGitLabDelete) {
        outcome
        message
        project { ${PROJECT_FIELDS} }
      }
    }
  `,
  migrateProjectToAutoDevops: `
    mutation Migrate($id: ID!, $input: MigrateProjectToAutoDevopsInput) {
      migrateProjectToAutoDevops(id: $id, input: $input) { ${PROJECT_FIELDS} }
    }
  `,
  setPinnedV1: `
    mutation SetPinnedV1($id: ID!, $pinned: Boolean!) {
      setPinnedV1(id: $id, pinned: $pinned) { ${PROJECT_FIELDS} }
    }
  `,
  updateProjectSonarConfig: `
    mutation UpdateProjectSonarConfig($id: ID!, $input: UpdateProjectSonarConfigInput!) {
      updateProjectSonarConfig(id: $id, input: $input) { ${PROJECT_FIELDS} }
    }
  `,
  provisionSonarProjects: `
    mutation ProvisionSonarProjects(
      $id: ID!
      $branches: [String!]!
      $addToAllowedBranches: Boolean
    ) {
      provisionSonarProjects(
        id: $id
        branches: $branches
        addToAllowedBranches: $addToAllowedBranches
      ) {
        ${SONAR_PROVISION_FIELDS}
      }
    }
  `,
  deleteSonarProjects: `
    mutation DeleteSonarProjects($id: ID!, $branches: [String!]!) {
      deleteSonarProjects(id: $id, branches: $branches)
    }
  `,
  uploadEnvProfile: `
    mutation UploadEnvProfile($projectId: ID!, $input: UploadEnvProfileInput!) {
      uploadEnvProfile(projectId: $projectId, input: $input) {
        id
        label
        injectionPhase
        branches
        deploymentTargetKeys
        jobSelector
        workspacePath
        filename
        buildDelivery
        vaultPath
        contentType
        keyNames
        updatedAt
      }
    }
  `,
  deleteEnvProfile: `
    mutation DeleteEnvProfile($projectId: ID!, $profileId: String!) {
      deleteEnvProfile(projectId: $projectId, profileId: $profileId) { ${PROJECT_FIELDS} }
    }
  `,
} as const;
