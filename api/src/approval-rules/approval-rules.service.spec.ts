import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';

import { GitLabService } from '../gitlab/gitlab.service';
import { AuditLog } from '../projects/schemas/audit-log.schema';
import { Project } from '../projects/schemas/project.schema';

import { ApprovalRulesService } from './approval-rules.service';

const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    on: jest.fn(),
    end: jest.fn(),
  })),
}));

describe('ApprovalRulesService', () => {
  const project = { gitlabProjectId: 42, gitlabPath: 'clients/acme/app', effectiveSlug: 'app' };
  const config = {
    'gitlab.url': 'http://gitlab',
    'gitlab.token': 'test-token',
    'gitlabPlugins.db': { host: 'postgres', port: 5432, name: 'db', user: 'u', password: 'p' },
  } as Record<string, unknown>;

  let service: ApprovalRulesService;
  let httpGet: jest.Mock;
  let auditCreate: jest.Mock;
  let findById: jest.Mock;
  let gitlab: { getProject: jest.Mock; getFileContent: jest.Mock };

  const build = async (overrides: Record<string, unknown> = {}) => {
    const values = { ...config, ...overrides };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalRulesService,
        { provide: ConfigService, useValue: { get: (key: string) => values[key] } },
        { provide: HttpService, useValue: { get: httpGet } },
        { provide: GitLabService, useValue: gitlab },
        { provide: getModelToken(Project.name), useValue: { findById } },
        { provide: getModelToken(AuditLog.name), useValue: { create: auditCreate } },
      ],
    }).compile();
    return moduleRef.get(ApprovalRulesService);
  };

  beforeEach(async () => {
    mockQuery.mockReset();
    httpGet = jest.fn();
    auditCreate = jest.fn();
    findById = jest
      .fn()
      .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(project) }) });
    gitlab = {
      getProject: jest.fn().mockResolvedValue({ default_branch: 'main' }),
      getFileContent: jest.fn().mockResolvedValue(null),
    };
    service = await build();
  });

  it('reports the source: console rules, then the repository file, then none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await service.get('p1')).source).toBe('none');

    mockQuery.mockResolvedValueOnce({ rows: [] });
    gitlab.getFileContent.mockResolvedValueOnce('rules: []');
    const fromFile = await service.get('p1');
    expect(fromFile.source).toBe('file');
    expect(fromFile.repositoryFile).toBe('rules: []');
    expect(gitlab.getFileContent).toHaveBeenLastCalledWith(42, '.gitlab/approvals.yml', 'main');

    const stored = { rules: [{ name: 'default', required: 2 }] };
    mockQuery.mockResolvedValueOnce({
      rows: [{ config: stored, updated_by: 'oidc:sam', updated_at: new Date(0) }],
    });
    gitlab.getFileContent.mockResolvedValueOnce('rules: []');
    const fromConsole = await service.get('p1');
    expect(fromConsole.source).toBe('console');
    expect(fromConsole.config).toEqual(stored);
    expect(fromConsole.updatedBy).toBe('oidc:sam');
  });

  it('stores normalized rules keyed by the GitLab project id and audits the change', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    httpGet.mockImplementation((url: string) =>
      url.endsWith('/users')
        ? of({ status: 200, data: [{ username: 'alice', state: 'active' }] })
        : of({ status: 200, data: {} }),
    );

    await service.set('p1', {
      rules: [{ name: 'security', required: 1, users: ['@alice'], groups: ['sec/team'] }],
    });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO dsoaas_approval_rule_sets');
    expect(params[0]).toBe(42);
    expect(JSON.parse(params[1] as string)).toEqual({
      rules: [
        { name: 'security', required: 1, approvers: { users: ['alice'], groups: ['sec/team'] } },
      ],
      author_can_approve: false,
      committers_can_approve: true,
      reset_on_push: true,
    });
    expect(httpGet).toHaveBeenCalledWith(
      'http://gitlab/api/v4/groups/sec%2Fteam',
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'test-token' } }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'project.approval_rules.updated', projectId: 'p1' }),
    );
  });

  it('rejects invalid rules and unknown approvers without writing', async () => {
    await expect(service.set('p1', { rules: [] })).rejects.toBeInstanceOf(BadRequestException);

    httpGet.mockImplementation((url: string) =>
      url.endsWith('/users') ? of({ status: 200, data: [] }) : of({ status: 404, data: {} }),
    );
    await expect(
      service.set('p1', {
        rules: [{ name: 'a', required: 1, users: ['ghost'], groups: ['nope'] }],
      }),
    ).rejects.toThrow('GitLab user "ghost" doesn\'t exist. GitLab group "nope" doesn\'t exist.');

    expect(mockQuery).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('clears the row and audits it', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const view = await service.clear('p1');

    expect(mockQuery.mock.calls[0][0]).toContain('DELETE FROM dsoaas_approval_rule_sets');
    expect(mockQuery.mock.calls[0][1]).toEqual([42]);
    expect(view.source).toBe('none');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'project.approval_rules.cleared' }),
    );
  });

  it('fails clearly when the project, the table or the password is missing', async () => {
    findById.mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);

    mockQuery.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    await expect(service.get('p1')).rejects.toThrow('has not set up its database yet');

    const unconfigured = await build({
      'gitlabPlugins.db': { host: 'postgres', port: 5432, name: 'db', user: 'u' },
    });
    await expect(unconfigured.get('p1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
