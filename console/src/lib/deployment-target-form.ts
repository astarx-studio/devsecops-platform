import type { TargetApp } from "@/lib/types";

/** Form row for one app in the deployment target modal. */
export interface AppRowForm {
  id: string;
  name: string;
  image: string;
  dockerfile: string;
  host: string;
  hostOverridden: boolean;
  imageAuto: boolean;
  expanded: boolean;
  isDefault: boolean;
}

export interface TargetFormState {
  targetKey: string;
  enabled: boolean;
  deployRef: string;
  kubeNamespace: string;
  clusterProfile: import("@/lib/types").ClusterProfile;
  teardownK8sOnDisable: boolean;
  apps: AppRowForm[];
  monorepoMode: boolean;
}

export function deriveAppHostPreview(
  appName: string,
  targetKey: string,
  appsDomain: string,
): string {
  const name = appName.trim() || "<app>";
  const env = targetKey.trim() || "<env>";
  if (env === "prod") {
    return `${name}.${appsDomain}`;
  }
  return `${name}.${env}.${appsDomain}`;
}

export function createDefaultAppRow(
  slug: string,
  isDefault: boolean,
): AppRowForm {
  return {
    id: crypto.randomUUID(),
    name: slug,
    image: slug,
    dockerfile: "",
    host: "",
    hostOverridden: false,
    imageAuto: true,
    expanded: true,
    isDefault,
  };
}

export function targetFormFromProject(
  slug: string,
  target?: {
    key: string;
    enabled: boolean;
    deployRef: string;
    kubeNamespace: string;
    clusterProfile: import("@/lib/types").ClusterProfile;
    apps?: TargetApp[];
  },
): TargetFormState {
  if (!target) {
    return {
      targetKey: "",
      enabled: true,
      deployRef: "",
      kubeNamespace: "",
      clusterProfile: "DEV",
      teardownK8sOnDisable: true,
      apps: [createDefaultAppRow(slug, true)],
      monorepoMode: false,
    };
  }

  const apps = target.apps?.length
    ? target.apps.map((app, index) => ({
        id: crypto.randomUUID(),
        name: app.name,
        image: app.image,
        dockerfile: app.dockerfile === "Dockerfile" ? "" : app.dockerfile,
        host: app.host,
        hostOverridden: true,
        imageAuto: false,
        expanded: true,
        isDefault: false,
      }))
    : [createDefaultAppRow(slug, true)];

  return {
    targetKey: target.key,
    enabled: target.enabled,
    deployRef: target.deployRef === "none" ? "" : target.deployRef,
    kubeNamespace: target.kubeNamespace,
    clusterProfile: target.clusterProfile,
    teardownK8sOnDisable: true,
    apps,
    monorepoMode: apps.length > 1,
  };
}

export function resolveAppsForSubmit(
  form: TargetFormState,
  appsDomain: string,
): Array<{ name: string; image: string; dockerfile?: string; host?: string }> {
  const targetKey = form.targetKey.trim();
  return form.apps.map((row) => {
    const name = row.name.trim();
    const image = row.image.trim();
    const host =
      row.hostOverridden && row.host.trim()
        ? row.host.trim()
        : deriveAppHostPreview(name, targetKey, appsDomain);
    return {
      name,
      image,
      dockerfile: row.dockerfile.trim() || undefined,
      host,
    };
  });
}
