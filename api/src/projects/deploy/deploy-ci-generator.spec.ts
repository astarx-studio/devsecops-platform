import { load } from 'js-yaml';

import { generateBuildJobsCiYaml, generateDeployTargetsCiYaml } from './deploy-ci-generator';

import type { DeploymentTarget } from '../schemas/project.schema';

describe('deploy-ci-generator', () => {
  const targetWithApps: DeploymentTarget = {
    key: 'dev',

    kubeNamespace: 'dev',

    clusterProfile: 'dev',

    appHost: 'app-one.dev.apps.example.com',

    deployRef: 'develop',

    enabled: true,

    apps: [
      {
        name: 'app-one',

        image: 'app-one',

        dockerfile: 'app-one.Dockerfile',

        host: 'app-one.dev.apps.example.com',
      },

      {
        name: 'app-two',

        image: 'app-two',

        dockerfile: 'app-two.Dockerfile',

        host: 'app-two.dev.apps.example.com',
      },
    ],
  };

  const monorepoTarget: DeploymentTarget = {
    key: 'dev',

    kubeNamespace: 'dev',

    clusterProfile: 'dev',

    appHost: 'portal.dev.apps.example.com',

    deployRef: 'development',

    enabled: true,

    apps: [
      {
        name: 'portal',

        image: 'portal',

        dockerfile: 'portal.Dockerfile',

        host: 'portal.dev.apps.example.com',
      },

      {
        name: 'reports',

        image: 'reports',

        dockerfile: 'reports.Dockerfile',

        host: 'reports.dev.apps.example.com',
      },
    ],
  };

  it('generates per-app deploy jobs and disables built-in deploy:dev', () => {
    const yaml = generateDeployTargetsCiYaml([targetWithApps]);

    expect(yaml).toContain('deploy:dev:');

    expect(yaml).toContain('when: never');

    expect(yaml).toContain('deploy:dev-app-one:');

    expect(yaml).toContain('deploy:dev-app-two:');

    expect(yaml).toContain('resource_group: deploy-dev');
  });

  it('parses valid YAML with disable block before per-app jobs (monorepo layout)', () => {
    const yaml = generateDeployTargetsCiYaml([monorepoTarget]);

    const doc = load(yaml) as Record<string, Record<string, unknown>>;

    expect(doc['deploy:dev']?.rules).toEqual([{ when: 'never' }]);

    expect(doc['deploy:dev-portal']?.extends).toBe('.deploy-helm');

    expect(doc['deploy:dev-reports']?.extends).toBe('.deploy-helm');

    expect(doc['deploy:dev-portal']?.environment).toEqual({
      name: 'dev-portal',
      url: 'https://$APP_HOST',
    });

    expect(doc['deploy:dev-portal']?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ if: '$DEPLOY_DEV_REF == "none"', when: 'never' }),
      ]),
    );

    const disableIdx = yaml.indexOf('deploy:dev:');

    const firstAppIdx = yaml.indexOf('deploy:dev-portal:');

    expect(disableIdx).toBeGreaterThan(-1);

    expect(firstAppIdx).toBeGreaterThan(disableIdx);

    expect(yaml.indexOf('extends: .deploy-helm', firstAppIdx)).toBeGreaterThan(firstAppIdx);
  });

  it('generates build jobs and disables default build', () => {
    const yaml = generateBuildJobsCiYaml([targetWithApps]);

    expect(yaml).toContain('build:\n  rules:\n    - when: never');

    expect(yaml).toContain('build:app-one:');

    expect(yaml).toContain('KANIKO_DOCKERFILE: "app-one.Dockerfile"');

    expect(yaml).toContain('KANIKO_IMAGE_NAME: "app-one"');
  });

  it('deduplicates build jobs when the same image appears on dev/stg/prod', () => {
    const app = {
      name: 'shared-svc',
      image: 'shared-svc',
      dockerfile: 'Dockerfile',
      host: 'shared-svc.dev.apps.example.com',
    };
    const targets: DeploymentTarget[] = ['dev', 'stg', 'prod'].map((key) => ({
      key,
      kubeNamespace: key,
      clusterProfile: key as DeploymentTarget['clusterProfile'],
      appHost: app.host,
      deployRef: 'main',
      enabled: true,
      apps: [app],
    }));
    const yaml = generateBuildJobsCiYaml(targets);
    expect(yaml.match(/^build:shared-svc:/gm)).toHaveLength(1);
    expect(yaml).toContain('KANIKO_IMAGE_NAME: "shared-svc"');
  });
});
