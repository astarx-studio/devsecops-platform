import { registerEnumType } from '@nestjs/graphql';

/**
 * Deployment environment — matches the k3d namespace names (dev, stg, prod).
 * Used in mutations that target a specific environment (e.g. setHostnameOverride).
 */
export enum Env {
  DEV = 'dev',
  STG = 'stg',
  PROD = 'prod',
}

registerEnumType(Env, {
  name: 'Env',
  description: 'Deployment environment (matches k3d namespace names).',
  valuesMap: {
    DEV: { description: 'Development environment' },
    STG: { description: 'Staging environment' },
    PROD: { description: 'Production environment' },
  },
});

/**
 * Project provisioning strategy.
 * - AUTO_DEVOPS: project was created directly with Auto DevOps pipeline
 * - TEMPLATE: project was forked from a template in the templates group
 */
export enum Provisioning {
  AUTO_DEVOPS = 'auto-devops',
  TEMPLATE = 'template',
}

registerEnumType(Provisioning, {
  name: 'Provisioning',
  description: 'How the project was initially provisioned.',
  valuesMap: {
    AUTO_DEVOPS: { description: 'Created with Auto DevOps pipeline (no template fork)' },
    TEMPLATE: { description: 'Forked from a template in the templates group' },
  },
});
