import type { GitLabProject, GitLabGroup, GitLabTreeItem } from '../../src/gitlab/gitlab.service';

let _nextId = 100;
const nextId = () => _nextId++;

export function gitlabProjectFactory(overrides: Partial<GitLabProject> = {}): GitLabProject {
  const id = overrides.id ?? nextId();
  const name = overrides.name ?? `project-${id}`;
  return {
    id,
    name,
    path: name,
    path_with_namespace: `clients/acme/${name}`,
    web_url: `https://gitlab.devops.test.net/clients/acme/${name}`,
    description: null,
    default_branch: 'main',
    last_activity_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function gitlabGroupFactory(overrides: Partial<GitLabGroup> = {}): GitLabGroup {
  const id = overrides.id ?? nextId();
  const name = overrides.name ?? `group-${id}`;
  return {
    id,
    name,
    path: name.toLowerCase(),
    full_path: name.toLowerCase(),
    ...overrides,
  };
}

export function gitlabTreeItemFactory(overrides: Partial<GitLabTreeItem> = {}): GitLabTreeItem {
  return {
    id: 'abc123',
    name: 'main.ts',
    type: 'blob',
    path: 'src/main.ts',
    mode: '100644',
    ...overrides,
  };
}

export function createProjectDtoFactory(overrides: Record<string, unknown> = {}) {
  return {
    clientName: 'acme',
    projectName: 'webapp',
    templateSlug: 'nestjs-app',
    ...overrides,
  };
}

export function createTemplateDtoFactory(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'nestjs-app',
    description: 'NestJS starter template',
    ...overrides,
  };
}

export function createConfigDtoFactory(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'node-pipeline',
    description: 'Node.js CI pipeline',
    ciContent: '.lint:\n  stage: lint\n  script:\n    - pnpm lint\n',
    ...overrides,
  };
}
