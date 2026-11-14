"use client";

import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import AppRegistrationOutlinedIcon from "@mui/icons-material/AppRegistrationOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import {
  Box,
  Button,
  Drawer,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { ConsoleNavigation } from "@/components/ConsoleNavigation";
import { OverviewPanel } from "@/components/OverviewPanel";
import { PageHeader } from "@/components/PageHeader";
import { PanelFallback } from "@/components/PanelFallback";
import { ProjectList, type ListCategory } from "@/components/ProjectList";
import { SettingsBar } from "@/components/SettingsBar";
import {
  CONSOLE_SECTIONS,
  isConsoleSection,
  type ConsoleSection,
} from "@/lib/console-sections";
import type { Project } from "@/lib/types";

const CreateProjectForm = dynamic(
  () => import("@/components/CreateProjectForm").then((mod) => mod.CreateProjectForm),
  { loading: () => <PanelFallback label="the form" /> },
);
const RegisterProjectForm = dynamic(
  () => import("@/components/RegisterProjectForm").then((mod) => mod.RegisterProjectForm),
  { loading: () => <PanelFallback label="the form" /> },
);
const McpAccessPanel = dynamic(
  () => import("@/components/McpAccessPanel").then((mod) => mod.McpAccessPanel),
  { loading: () => <PanelFallback label="MCP" /> },
);
const LogsPanel = dynamic(
  () => import("@/components/LogsPanel").then((mod) => mod.LogsPanel),
  { loading: () => <PanelFallback label="logs" /> },
);
const ProjectDetail = dynamic(
  () => import("@/components/ProjectDetail").then((mod) => mod.ProjectDetail),
  { loading: () => <PanelFallback label="the project" /> },
);

function ProvisioningAside({ type }: { type: "create" | "register" }) {
  const items =
    type === "create"
      ? [
          "Use a unique, slash-separated GitLab group path.",
          "Choose Auto DevOps or an approved platform template.",
          "Deployment and publishing capabilities are applied during provisioning.",
        ]
      : [
          "Find the numeric project ID on the GitLab project overview.",
          "Deployment wiring connects Vault, CI, and deployment targets.",
          "Branch options can be set globally or per environment.",
        ];

  return (
    <Paper variant="outlined" sx={{ p: 2.5, alignSelf: "start", bgcolor: "#f0f4f4" }}>
      <Typography variant="h6" component="h2" sx={{ mb: 0.75 }}>
        {type === "create" ? "Provisioning checklist" : "Before you register"}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {type === "create"
          ? "A few decisions now establish the project’s delivery foundation."
          : "Confirm the repository and delivery model before connecting it."}
      </Typography>
      <Stack spacing={1.75}>
        {items.map((item) => (
          <Stack key={item} direction="row" spacing={1.25} alignItems="flex-start">
            <CheckCircleOutlineIcon sx={{ fontSize: 19, color: "primary.main", mt: 0.15 }} />
            <Typography variant="body2" color="text.secondary">
              {item}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

export function ConsolePage() {
  const searchParams = useSearchParams();
  const initialView = searchParams.get("view");
  const [section, setSection] = useState<ConsoleSection>(
    isConsoleSection(initialView) ? initialView : "overview",
  );
  const [selected, setSelected] = useState<Project | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [listCategory, setListCategory] = useState<ListCategory>("active");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const router = useRouter();
  const preferredId = searchParams.get("id");
  const preferredSlug = searchParams.get("slug");

  const navigate = useCallback(
    (nextSection: ConsoleSection) => {
      setSection(nextSection);
      setNavigationOpen(false);
      const next = new URLSearchParams(searchParams.toString());
      if (nextSection === "overview") next.delete("view");
      else next.set("view", nextSection);
      if (nextSection !== "projects") {
        next.delete("id");
        next.delete("slug");
      }
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    },
    [router, searchParams],
  );

  const selectProject = useCallback(
    (project: Project) => {
      setSelected(project);
      setSection("projects");
      setListCategory(project.archived ? "archived" : "active");
      setNavigationOpen(false);
      const next = new URLSearchParams(searchParams.toString());
      next.set("view", "projects");
      next.set("id", project.id);
      next.delete("slug");
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const bumpRefresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  const handleCreated = useCallback(
    (project: Project) => {
      setSelected(project);
      setSection("projects");
      setListCategory("active");
      bumpRefresh();
      const next = new URLSearchParams(searchParams.toString());
      next.set("view", "projects");
      next.set("id", project.id);
      next.delete("slug");
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [bumpRefresh, router, searchParams],
  );

  const createAction = (
    <Button
      variant="contained"
      startIcon={<AddOutlinedIcon />}
      onClick={() => navigate("create")}
    >
      Create project
    </Button>
  );

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box
        component="a"
        href="#main"
        onClick={(event) => {
          const main = document.getElementById("main");
          if (!main) return;
          event.preventDefault();
          main.focus();
        }}
        sx={{
          position: "fixed",
          left: 16,
          top: -56,
          zIndex: (theme) => theme.zIndex.tooltip,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          px: 2,
          py: 1,
          borderRadius: 1,
          fontWeight: 600,
          "&:focus": { top: 12 },
        }}
      >
        Skip to main content
      </Box>

      <Box
        component="aside"
        sx={{
          display: { xs: "none", md: "block" },
          position: "fixed",
          inset: "0 auto 0 0",
          width: 248,
          zIndex: (theme) => theme.zIndex.drawer,
        }}
      >
        <ConsoleNavigation section={section} onNavigate={navigate} />
      </Box>
      <Drawer
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { md: "none" } }}
        PaperProps={{ sx: { width: 280 } }}
      >
        <ConsoleNavigation section={section} onNavigate={navigate} />
      </Drawer>

      <Box sx={{ ml: { md: "248px" }, minWidth: 0 }}>
        <SettingsBar
          sectionTitle={CONSOLE_SECTIONS[section].shortTitle}
          onOpenNavigation={() => setNavigationOpen(true)}
        />
        <Box
          component="main"
          id="main"
          tabIndex={-1}
          sx={{
            maxWidth: 1600,
            mx: "auto",
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2.5, md: 3.5 },
            "&:focus": { outline: "none" },
          }}
        >
          <PageHeader
            title={CONSOLE_SECTIONS[section].title}
            description={CONSOLE_SECTIONS[section].description}
            actions={
              section === "overview" || section === "projects"
                ? createAction
                : section === "create"
                  ? <Button variant="outlined" onClick={() => navigate("register")}>Register existing instead</Button>
                  : undefined
            }
          />

          {section === "overview" && (
            <OverviewPanel
              refreshToken={refreshToken}
              onNavigate={navigate}
              onSelectProject={selectProject}
            />
          )}

          {section === "projects" && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(300px, 350px) minmax(0, 1fr)" },
                gap: 2,
                height: { lg: "calc(100dvh - 222px)" },
                minHeight: { lg: 600 },
                alignItems: "stretch",
              }}
            >
              <Box sx={{ minHeight: { xs: 480, lg: 0 }, minWidth: 0 }}>
                <ProjectList
                  selectedId={selected?.id ?? null}
                  onSelect={selectProject}
                  preferredId={preferredId}
                  preferredSlug={preferredSlug}
                  refreshToken={refreshToken}
                  category={listCategory}
                  onCategoryChange={(category) => {
                    setListCategory(category);
                    setSelected(null);
                  }}
                  onDetected={bumpRefresh}
                />
              </Box>
              <Box sx={{ minHeight: { xs: 440, lg: 0 }, minWidth: 0 }}>
                {selected ? (
                  <ProjectDetail
                    project={selected}
                    onUpdated={(project) => {
                      setSelected(project);
                      bumpRefresh();
                    }}
                    onDeleted={() => {
                      setSelected(null);
                      bumpRefresh();
                      const next = new URLSearchParams(searchParams.toString());
                      next.delete("id");
                      next.delete("slug");
                      router.replace(`/?${next.toString()}`, { scroll: false });
                    }}
                    onArchived={(project) => {
                      setSelected(project);
                      setListCategory("archived");
                      bumpRefresh();
                    }}
                  />
                ) : (
                  <Paper
                    variant="outlined"
                    role="status"
                    sx={{
                      height: "100%",
                      minHeight: 300,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      p: 4,
                      textAlign: "center",
                    }}
                  >
                    <Stack alignItems="center" spacing={1.5} maxWidth={360}>
                      <FolderOpenOutlinedIcon sx={{ fontSize: 42, color: "text.disabled" }} />
                      <Typography variant="h6" component="h2">
                        Select a project to manage it
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Review delivery configuration, variables, quality gates, audit events, and application logs.
                      </Typography>
                      <Button variant="outlined" startIcon={<AppRegistrationOutlinedIcon />} onClick={() => navigate("register")}>
                        Register existing project
                      </Button>
                    </Stack>
                  </Paper>
                )}
              </Box>
            </Box>
          )}

          {(section === "create" || section === "register") && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 300px" },
                gap: 2,
                maxWidth: 1100,
                alignItems: "start",
              }}
            >
              {section === "create" ? (
                <CreateProjectForm onCreated={handleCreated} />
              ) : (
                <RegisterProjectForm onRegistered={handleCreated} />
              )}
              <ProvisioningAside type={section} />
            </Box>
          )}

          {section === "logs" && (
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
              <LogsPanel />
            </Paper>
          )}
          {section === "mcp" && <McpAccessPanel />}
        </Box>
      </Box>
    </Box>
  );
}
