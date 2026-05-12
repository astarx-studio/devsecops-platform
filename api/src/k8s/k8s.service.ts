import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  V1Deployment,
} from '@kubernetes/client-node';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfiguration } from '../config';

import type { DeployEnv } from '../projects/schemas/project.schema';

/** Kubernetes API clients bundled per deployment environment. */
interface EnvClients {
  core: CoreV1Api;
  apps: AppsV1Api;
  networking: NetworkingV1Api;
}

/** Deployment status keyed by environment. */
export type DeploymentStatusMap = Partial<Record<DeployEnv, string>>;

/**
 * Kubernetes client module that manages one kubeconfig per deployment
 * environment (dev, stg, prod).
 *
 * Kubeconfig files are read from `KUBECONFIG_DIR` at module initialisation.
 * If a file is missing for an environment the client for that env is omitted
 * and a warning is logged — the service degrades gracefully so that
 * environments that ARE configured continue to function.
 *
 * All public methods are safe to call even when a particular env is not
 * configured; they return sensible defaults and log a warning instead of
 * throwing.
 */
@Injectable()
export class K8sService implements OnModuleInit {
  private readonly logger = new Logger(K8sService.name);
  private readonly configDir: string;
  private readonly clients = new Map<DeployEnv, EnvClients>();

  constructor(configService: ConfigService<AppConfiguration>) {
    this.configDir = configService.get<string>('kube.configDir', { infer: true })!;
  }

  onModuleInit(): void {
    this.logger.log(`Loading kubeconfigs from: ${this.configDir}`);
    for (const env of ['dev', 'stg', 'prod'] as DeployEnv[]) {
      this.initEnv(env);
    }
    const loaded = [...this.clients.keys()];
    this.logger.log(
      loaded.length > 0
        ? `K8s clients loaded for environments: ${loaded.join(', ')}`
        : 'No kubeconfigs found — K8s integration disabled',
    );
  }

  /**
   * Ensures the target Kubernetes namespace exists.
   * In the current platform model dev/stg/prod namespaces are pre-created
   * by bootstrap/k8s-primitives.sh, so this is effectively a no-op health check.
   * If the namespace is missing (e.g. on a fresh cluster), it will be created.
   *
   * @param env - Target deployment environment
   */
  async ensureNamespace(env: DeployEnv): Promise<void> {
    const clients = this.clients.get(env);
    if (!clients) {
      this.logger.warn(`ensureNamespace(${env}): no kubeconfig available, skipping`);
      return;
    }

    try {
      await clients.core.readNamespace({ name: env });
      this.logger.debug(`Namespace "${env}" already exists`);
    } catch (error: unknown) {
      const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
      if (status === 404) {
        this.logger.log(`Namespace "${env}" not found — creating`);
        await clients.core.createNamespace({
          body: { metadata: { name: env } },
        });
        this.logger.log(`Namespace "${env}" created`);
      } else {
        // 403 = no permissions to read namespaces (limited RBAC) — assume it exists
        this.logger.warn(
          `ensureNamespace(${env}): cannot verify namespace existence (HTTP ${status ?? 'unknown'}), assuming it exists`,
        );
      }
    }
  }

  /**
   * Lists all Helm releases (Deployments) for a given `effectiveSlug` across
   * all configured environments.
   *
   * @param effectiveSlug - The Helm release name / Deployment name to look up
   * @returns Map of env → deployment status string (e.g. "Available 1/1", "Pending")
   */
  async listProjectDeployments(effectiveSlug: string): Promise<DeploymentStatusMap> {
    const result: DeploymentStatusMap = {};

    for (const [env, clients] of this.clients.entries()) {
      try {
        const deployment = await clients.apps.readNamespacedDeployment({
          name: effectiveSlug,
          namespace: env,
        });
        result[env] = this.summariseDeployment(deployment);
        this.logger.debug(
          `listProjectDeployments(${effectiveSlug}, ${env}): status="${result[env]}"`,
        );
      } catch (error: unknown) {
        const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
        if (status === 404) {
          this.logger.debug(`No deployment "${effectiveSlug}" in namespace "${env}"`);
        } else {
          this.logger.warn(
            `listProjectDeployments(${effectiveSlug}, ${env}): HTTP ${status ?? 'unknown'}`,
          );
        }
      }
    }

    return result;
  }

  /**
   * Reads the active Ingress hostname for a release in the given environment.
   *
   * @param env - Target deployment environment
   * @param effectiveSlug - The Ingress name (same as Helm release name)
   * @returns The first Ingress rule host, or undefined if not found
   */
  async getAppUrl(env: DeployEnv, effectiveSlug: string): Promise<string | undefined> {
    const clients = this.clients.get(env);
    if (!clients) {
      this.logger.warn(`getAppUrl(${env}, ${effectiveSlug}): no kubeconfig available`);
      return undefined;
    }

    try {
      const ingress = await clients.networking.readNamespacedIngress({
        name: effectiveSlug,
        namespace: env,
      });
      const host = ingress.spec?.rules?.[0]?.host;
      this.logger.debug(`getAppUrl(${env}, ${effectiveSlug}): host="${host ?? 'none'}"`);
      return host;
    } catch (error: unknown) {
      const status = (error as { response?: { statusCode?: number } }).response?.statusCode;
      this.logger.debug(
        `getAppUrl(${env}, ${effectiveSlug}): Ingress not found (HTTP ${status ?? 'unknown'})`,
      );
      return undefined;
    }
  }

  /**
   * Triggers a rolling restart of a Deployment by patching the pod template
   * annotation `kubectl.kubernetes.io/restartedAt`.
   *
   * @param env - Target deployment environment
   * @param releaseName - The Deployment name to restart
   */
  async restartDeployment(env: DeployEnv, releaseName: string): Promise<void> {
    const clients = this.clients.get(env);
    if (!clients) {
      this.logger.warn(`restartDeployment(${env}, ${releaseName}): no kubeconfig available`);
      return;
    }

    this.logger.log(`Triggering rolling restart: deployment="${releaseName}" namespace="${env}"`);

    await clients.apps.patchNamespacedDeployment({
      name: releaseName,
      namespace: env,
      body: {
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
              },
            },
          },
        },
      },
    });

    this.logger.log(`Rolling restart triggered: deployment="${releaseName}" namespace="${env}"`);
  }

  /**
   * Returns the base64-encoded kubeconfig for a given environment.
   * Used during project provisioning to set `KUBECONFIG_B64` CI var.
   *
   * @param env - Target deployment environment
   * @returns Base64-encoded kubeconfig string, or undefined if not available
   */
  getKubeconfigB64(env: DeployEnv): string | undefined {
    const filePath = join(this.configDir, `kubeconfig-${env}.yaml`);
    if (!existsSync(filePath)) {
      this.logger.warn(`getKubeconfigB64(${env}): file not found at ${filePath}`);
      return undefined;
    }
    // Base64-encode the raw YAML so it can be stored as a single-line GitLab
    // CI variable. The runner decodes it with: echo "$KUBECONFIG_B64" | base64 -d
    return Buffer.from(readFileSync(filePath, 'utf-8').trim()).toString('base64');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Initialises K8s clients for one environment from its kubeconfig file. */
  private initEnv(env: DeployEnv): void {
    const filePath = join(this.configDir, `kubeconfig-${env}.yaml`);

    if (!existsSync(filePath)) {
      this.logger.warn(`Kubeconfig not found for env "${env}" at: ${filePath}`);
      return;
    }

    try {
      const kc = new KubeConfig();
      kc.loadFromFile(filePath);

      this.clients.set(env, {
        core: kc.makeApiClient(CoreV1Api),
        apps: kc.makeApiClient(AppsV1Api),
        networking: kc.makeApiClient(NetworkingV1Api),
      });

      this.logger.debug(`Kubeconfig loaded for env "${env}" from: ${filePath}`);
    } catch (error) {
      this.logger.error(
        `Failed to load kubeconfig for env "${env}": ${(error as Error).message}`,
      );
    }
  }

  /**
   * Produces a human-readable status summary from a Kubernetes Deployment object.
   *
   * @param deployment - The deployment resource returned from the k8s API
   * @returns Short status string such as "Available 2/2" or "Progressing 1/2"
   */
  private summariseDeployment(deployment: V1Deployment): string {
    const desired = deployment.spec?.replicas ?? 1;
    const ready = deployment.status?.readyReplicas ?? 0;

    const conditions = deployment.status?.conditions ?? [];
    const available = conditions.find((c) => c.type === 'Available');
    const progressing = conditions.find((c) => c.type === 'Progressing');

    if (available?.status === 'True') {
      return `Available ${ready}/${desired}`;
    }
    if (progressing?.status === 'True') {
      return `Progressing ${ready}/${desired}`;
    }
    return `Unknown ${ready}/${desired}`;
  }
}
