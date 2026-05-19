'use client';

import AddIcon from '@mui/icons-material/Add';
import AppRegistrationIcon from '@mui/icons-material/AppRegistration';
import { Box, Container, Grid, Tab, Tabs, Typography } from '@mui/material';
import { useCallback, useState } from 'react';

import type { Project } from '@/lib/types';
import { CreateProjectForm } from '@/components/CreateProjectForm';
import { ProjectDetail } from '@/components/ProjectDetail';
import { ProjectList, type ListCategory } from '@/components/ProjectList';
import { RegisterProjectForm } from '@/components/RegisterProjectForm';
import { SettingsBar } from '@/components/SettingsBar';

export function ConsolePage() {
  const [selected, setSelected] = useState<Project | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [tab, setTab] = useState(0);
  const [listCategory, setListCategory] = useState<ListCategory>('active');

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
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SettingsBar />
      <Container maxWidth="xl" sx={{ flex: 1, py: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Projects" />
          <Tab icon={<AddIcon />} iconPosition="start" label="Create" />
          <Tab icon={<AppRegistrationIcon />} iconPosition="start" label="Register" />
        </Tabs>

        {tab === 0 && (
          <Grid container spacing={2} sx={{ height: 'calc(100vh - 180px)' }}>
            <Grid item xs={12} md={4} sx={{ height: '100%' }}>
              <ProjectList
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                refreshToken={refreshToken}
                category={listCategory}
                onCategoryChange={(cat) => {
                  setListCategory(cat);
                  setSelected(null);
                }}
                onDetected={bumpRefresh}
              />
            </Grid>
            <Grid item xs={12} md={8} sx={{ height: '100%' }}>
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
                    setListCategory('archived');
                    bumpRefresh();
                  }}
                />
              ) : (
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <Typography color="text.secondary">Select a project</Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        )}

        {tab === 1 && (
          <Box maxWidth={560}>
            <CreateProjectForm onCreated={handleCreated} />
          </Box>
        )}

        {tab === 2 && (
          <Box maxWidth={560}>
            <RegisterProjectForm onRegistered={handleCreated} />
          </Box>
        )}
      </Container>
    </Box>
  );
}
