'use client';

import AddIcon from '@mui/icons-material/Add';
import AppRegistrationIcon from '@mui/icons-material/AppRegistration';
import HistoryIcon from "@mui/icons-material/History";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { Box, Container, Grid, Tab, Tabs, Typography } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import type { Project } from "@/lib/types";
import { LogsPanel } from "@/components/LogsPanel";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { McpAccessPanel } from "@/components/McpAccessPanel";
import { ProjectDetail } from "@/components/ProjectDetail";
import { ProjectList, type ListCategory } from "@/components/ProjectList";
import { RegisterProjectForm } from "@/components/RegisterProjectForm";
import { SettingsBar } from "@/components/SettingsBar";

export function ConsolePage() {
  const [selected, setSelected] = useState<Project | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [tab, setTab] = useState(0);
  const [listCategory, setListCategory] = useState<ListCategory>("active");
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredId = searchParams.get("id");
  const preferredSlug = searchParams.get("slug");

  const selectProject = useCallback(
    (project: Project) => {
      setSelected(project);
      const next = new URLSearchParams(searchParams.toString());
      next.set("id", project.id);
      next.delete("slug");
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const bumpRefresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const handleCreated = useCallback(
    (project: Project) => {
      setSelected(project);
      setTab(0);
      bumpRefresh();
    },
    [bumpRefresh],
  );

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
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
          position: "absolute",
          left: 8,
          top: -48,
          zIndex: (theme) => theme.zIndex.tooltip,
          bgcolor: "primary.main",
          color: "background.default",
          px: 2,
          py: 1,
          borderRadius: 1,
          fontWeight: 600,
          "&:focus": { top: 8 },
        }}
      >
        Skip to main content
      </Box>
      <SettingsBar />
      <Container
        component="main"
        id="main"
        tabIndex={-1}
        maxWidth="xl"
        sx={{ flex: 1, py: 2, "&:focus": { outline: "none" } }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          aria-label="Console sections"
          selectionFollowsFocus
          sx={{ mb: 2 }}
        >
          <Tab
            id="tab-projects"
            aria-controls="panel-projects"
            label="Projects"
          />
          <Tab
            id="tab-create"
            aria-controls="panel-create"
            icon={<AddIcon />}
            iconPosition="start"
            label="Create"
          />
          <Tab
            id="tab-register"
            aria-controls="panel-register"
            icon={<AppRegistrationIcon />}
            iconPosition="start"
            label="Register"
          />
          <Tab
            id="tab-mcp"
            aria-controls="panel-mcp"
            icon={<KeyOutlinedIcon />}
            iconPosition="start"
            label="MCP"
          />
          <Tab
            id="tab-logs"
            aria-controls="panel-logs"
            icon={<HistoryIcon />}
            iconPosition="start"
            label="Logs"
          />
        </Tabs>

        {tab === 0 && (
          <Grid
            container
            spacing={2}
            role="tabpanel"
            id="panel-projects"
            aria-labelledby="tab-projects"
            sx={{
              height: { xs: "auto", md: "calc(100vh - 220px)" },
              minHeight: { xs: 0, md: 480 },
            }}
          >
            <Grid
              item
              xs={12}
              md={4}
              sx={{
                height: { xs: "auto", md: "100%" },
                minHeight: { xs: 420, md: 0 },
              }}
            >
              <ProjectList
                selectedId={selected?.id ?? null}
                onSelect={selectProject}
                preferredId={preferredId}
                preferredSlug={preferredSlug}
                refreshToken={refreshToken}
                category={listCategory}
                onCategoryChange={(cat) => {
                  setListCategory(cat);
                  setSelected(null);
                }}
                onDetected={bumpRefresh}
              />
            </Grid>
            <Grid
              item
              xs={12}
              md={8}
              sx={{
                height: { xs: "auto", md: "100%" },
                minHeight: { xs: 320, md: 0 },
              }}
            >
              {selected ? (
                <ProjectDetail
                  project={selected}
                  onUpdated={(p) => {
                    setSelected(p);
                    bumpRefresh();
                  }}
                  onDeleted={() => {
                    setSelected(null);
                    bumpRefresh();
                  }}
                  onArchived={(p) => {
                    setSelected(p);
                    setListCategory("archived");
                    bumpRefresh();
                  }}
                />
              ) : (
                <Box
                  role="status"
                  sx={{
                    height: { xs: "auto", md: "100%" },
                    minHeight: 160,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    p: 3,
                  }}
                >
                  <Typography color="text.secondary">
                    Select a project from the list. On a small screen, the list
                    is above this area.
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        )}

        {tab === 1 && (
          <Box
            maxWidth={560}
            role="tabpanel"
            id="panel-create"
            aria-labelledby="tab-create"
          >
            <CreateProjectForm onCreated={handleCreated} />
          </Box>
        )}

        {tab === 2 && (
          <Box
            maxWidth={560}
            role="tabpanel"
            id="panel-register"
            aria-labelledby="tab-register"
          >
            <RegisterProjectForm onRegistered={handleCreated} />
          </Box>
        )}

        {tab === 3 && (
          <Box role="tabpanel" id="panel-mcp" aria-labelledby="tab-mcp">
            <McpAccessPanel />
          </Box>
        )}

        {tab === 4 && (
          <Box role="tabpanel" id="panel-logs" aria-labelledby="tab-logs">
            <LogsPanel />
          </Box>
        )}
      </Container>
    </Box>
  );
}
