import { load } from 'js-yaml';

import {
  MERGE_HEADER,
  mergeIncludeBlockFallback,
  mergeProjectGitlabCi,
  stripDsoaasManagedPreamble,
} from './merge-project-gitlab-ci';

describe('mergeProjectGitlabCi', () => {
  const includes = [{ project: 'configs/auto-devops-pipeline', file: '/.gitlab-ci.yml' }];

  it('preserves user test job when merging includes', () => {
    const existing = `

include:

  - project: old/project

    file: old.yml

test:

  script:

    - npm test

`;

    const { content, preservedUserKeys, skipRootWrite } = mergeProjectGitlabCi(existing, includes);

    expect(preservedUserKeys).toContain('test');

    expect(content).toContain('npm test');

    expect(content).toContain('configs/auto-devops-pipeline');

    expect(content).not.toContain('old/project');

    expect(skipRootWrite).toBe(false);
  });

  it('preserves variables and test when root has multiple user keys', () => {
    const existing = `

variables:

  NODE_VERSION: "20"

include:

  - project: legacy/pipeline

    file: ci.yml

test:

  script:

    - pnpm exec nx run-many -t test

`;

    const { content, preservedUserKeys, skipRootWrite } = mergeProjectGitlabCi(existing, includes);

    expect(skipRootWrite).toBe(false);

    expect(preservedUserKeys).toEqual(expect.arrayContaining(['test', 'variables']));

    expect(content).toContain('NODE_VERSION');

    expect(content).toContain('nx run-many');

    const doc = load(content) as Record<string, unknown>;

    expect(doc.test).toBeDefined();

    expect(doc.variables).toEqual({ NODE_VERSION: '20' });
  });

  it('returns managed-only content when existing is null', () => {
    const { content, preservedUserKeys, skipRootWrite } = mergeProjectGitlabCi(null, includes);

    expect(preservedUserKeys).toEqual([]);

    expect(content).toContain('include:');

    expect(skipRootWrite).toBe(false);
  });

  it('uses include fallback when parse fails and preserves test block', () => {
    const existing = `

include:

  - project: configs/old

    file: /.gitlab-ci.yml

test:

  before_script:

    - !reference [.load-vault-env, before_script]

  script:

    - npm run test:ci

`;

    const { content, skipRootWrite, usedIncludeFallback } = mergeProjectGitlabCi(
      existing,

      includes,
    );

    expect(skipRootWrite).toBe(false);

    expect(usedIncludeFallback).toBe(true);

    expect(content).toContain('npm run test:ci');

    expect(content).toContain('!reference');

    expect(content).toContain('configs/auto-devops-pipeline');

    expect(content).not.toContain('configs/old');
  });

  it('skips root write when parse fails and fallback cannot merge safely', () => {
    const existing = '{{{{ not valid ci yaml';
    const { skipRootWrite, parseWarning } = mergeProjectGitlabCi(existing, includes);
    expect(skipRootWrite).toBe(true);
    expect(parseWarning).toBeDefined();
  });

  it('collapses repeated DSOaaS merge headers on fallback re-merge', () => {
    const existing = `${MERGE_HEADER}
${MERGE_HEADER}
${MERGE_HEADER}
test:
  script:
    - npm test
`;
    const { content } = mergeProjectGitlabCi(existing, includes);
    expect(
      content.match(new RegExp(MERGE_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
    ).toHaveLength(1);
    expect(content).toContain('npm test');
  });
});

describe('stripDsoaasManagedPreamble', () => {
  it('removes duplicate merge header lines', () => {
    const cleaned = stripDsoaasManagedPreamble(
      `${MERGE_HEADER}\n${MERGE_HEADER}\ntest:\n  script: []\n`,
    );
    expect(cleaned).not.toContain(MERGE_HEADER);
    expect(cleaned).toContain('test:');
  });
});

describe('mergeIncludeBlockFallback', () => {
  it('prepends include when file has no include block', () => {
    const existing = `test:

  script:

    - echo ok`;

    const result = mergeIncludeBlockFallback(existing, [
      { project: 'configs/auto-devops-pipeline', file: '/.gitlab-ci.yml' },
    ]);

    expect(result).toContain('include:');

    expect(result).toContain('echo ok');
  });
});
