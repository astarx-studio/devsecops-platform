import {
  deployRefVariableName,
  ensureDeploymentTargets,
  isDeployRefDisabled,
  assertValidActiveDeployRef,
  assertValidTargetKey,
  resolveDefaultDeployRef,
} from './deploy-target.util';
import { DEPLOY_REF_DISABLED } from './deploy.constants';

describe('deploy-target.util', () => {
  it('maps prod-alt to DEPLOY_PROD_ALT_REF', () => {
    expect(deployRefVariableName('prod-alt')).toBe('DEPLOY_PROD_ALT_REF');
    expect(deployRefVariableName('dev')).toBe('DEPLOY_DEV_REF');
  });

  it('treats only none as disabled', () => {
    expect(isDeployRefDisabled('none')).toBe(true);
    expect(isDeployRefDisabled('null')).toBe(false);
    expect(isDeployRefDisabled('')).toBe(false);
    expect(DEPLOY_REF_DISABLED).toBe('none');
  });

  it('rejects none when enabling', () => {
    expect(() => assertValidActiveDeployRef('none', true)).toThrow();
    expect(() => assertValidActiveDeployRef('main', true)).not.toThrow();
    expect(() => assertValidActiveDeployRef('none', false)).not.toThrow();
  });

  it('rejects null and empty deploy refs', () => {
    expect(() => assertValidActiveDeployRef('', true)).toThrow();
    expect(() => assertValidActiveDeployRef('null', true)).toThrow();
  });

  it('validates target keys', () => {
    expect(() => assertValidTargetKey('prod-alt')).not.toThrow();
    expect(() => assertValidTargetKey('Prod')).toThrow();
  });

  it('provides default refs for standard keys only', () => {
    expect(resolveDefaultDeployRef('dev')).toBe('develop');
    expect(resolveDefaultDeployRef('prod-alt')).toBeUndefined();
  });

  it('keeps explicit empty deploymentTargets (does not re-derive dev/stg/prod)', () => {
    const targets = ensureDeploymentTargets(
      {
        deploymentTargets: [],
        effectiveSlug: 'my-app',
        capabilities: { deployable: true },
        appHosts: { dev: 'my-app.dev.apps.example.com' },
      },
      'apps.example.com',
    );
    expect(targets).toEqual([]);
  });
});
