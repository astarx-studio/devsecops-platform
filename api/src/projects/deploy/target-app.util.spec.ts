import { deriveAppHost, normalizeTargetApps, resolveHelmReleaseName } from './target-app.util';

describe('target-app.util', () => {
  it('deriveAppHost uses prod shape without env segment', () => {
    expect(deriveAppHost('app-one', 'prod', 'apps.example.com')).toBe('app-one.apps.example.com');
  });

  it('deriveAppHost uses env segment for non-prod', () => {
    expect(deriveAppHost('app-one', 'dev', 'apps.example.com')).toBe(
      'app-one.dev.apps.example.com',
    );
  });

  it('resolveHelmReleaseName collapses when image equals slug', () => {
    expect(resolveHelmReleaseName('myapp', 'myapp')).toBe('myapp');
    expect(resolveHelmReleaseName('myapp', 'app-one')).toBe('myapp-app-one');
  });

  it('rejects duplicate app names', () => {
    expect(() =>
      normalizeTargetApps(
        [
          { name: 'a', image: 'a' },
          { name: 'a', image: 'b' },
        ],
        'dev',
        'apps.example.com',
      ),
    ).toThrow(/duplicate app name/);
  });
});
