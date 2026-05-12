/**
 * Jest E2E stub for `@kubernetes/client-node` (ESM package breaks ts-jest).
 * Only symbols imported by `K8sService` need to exist.
 */
export class KubeConfig {
  loadFromFile(): void {}
}

export class CoreV1Api {}
export class AppsV1Api {}
export class NetworkingV1Api {}
export class V1Deployment {}
