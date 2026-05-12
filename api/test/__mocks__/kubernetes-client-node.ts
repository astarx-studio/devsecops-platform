/**
 * Manual mock for @kubernetes/client-node.
 *
 * @kubernetes/client-node v1.x ships as pure ESM which ts-jest (CommonJS
 * transform pipeline) cannot parse. Unit tests mock K8sService directly so
 * they never need the real Kubernetes client; this stub satisfies the import
 * without requiring a Babel transformation pipeline.
 */

export class KubeConfig {
  loadFromFile = jest.fn();
  loadFromDefault = jest.fn();
  makeApiClient = jest.fn().mockReturnValue({});
}

export class CoreV1Api {
  readNamespace = jest.fn();
  createNamespace = jest.fn();
}

export class AppsV1Api {
  readNamespacedDeployment = jest.fn();
  patchNamespacedDeployment = jest.fn();
}

export class NetworkingV1Api {
  readNamespacedIngress = jest.fn();
}

export class V1Deployment {}
export class V1Namespace {}
export class V1Ingress {}
