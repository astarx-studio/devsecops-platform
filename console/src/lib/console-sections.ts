export type ConsoleSection =
  | "overview"
  | "projects"
  | "create"
  | "register"
  | "logs"
  | "mcp"
  | "people";

export const CONSOLE_SECTIONS: Record<
  ConsoleSection,
  { title: string; shortTitle: string; description: string }
> = {
  overview: {
    title: "Platform overview",
    shortTitle: "Overview",
    description:
      "A live view of your project footprint, delivery configuration, and operator tasks.",
  },
  projects: {
    title: "Projects",
    shortTitle: "Projects",
    description:
      "Manage registered GitLab projects, deployment targets, variables, and quality gates.",
  },
  create: {
    title: "Create a project",
    shortTitle: "Create project",
    description:
      "Provision a GitLab project and configure its delivery capabilities from one workflow.",
  },
  register: {
    title: "Register an existing project",
    shortTitle: "Register existing",
    description:
      "Bring an existing GitLab project under DSOaaS management without recreating it.",
  },
  logs: {
    title: "Audit & logs",
    shortTitle: "Audit & logs",
    description:
      "Trace platform changes and inspect application container output from a single place.",
  },
  mcp: {
    title: "MCP access",
    shortTitle: "MCP access",
    description:
      "Issue scoped credentials for IDE clients and manage their access lifecycle.",
  },
  people: {
    title: "People & onboarding",
    shortTitle: "People",
    description:
      "Provision company email and platform access, then track each onboarding to completion.",
  },
};

export function isConsoleSection(value: string | null): value is ConsoleSection {
  return Boolean(value && value in CONSOLE_SECTIONS);
}
