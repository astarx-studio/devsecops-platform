"use client";

import { Box, Tab, Tabs } from "@mui/material";
import { useState } from "react";

import { AppContainerLogPanel } from "@/components/AppContainerLogPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";

export function LogsPanel() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_event, value: number) => setTab(value)}
        aria-label="Log sources"
        sx={{ mb: 2 }}
      >
        <Tab
          id="logs-audit-tab"
          aria-controls="logs-audit-panel"
          label="Audit"
        />
        <Tab
          id="logs-apps-tab"
          aria-controls="logs-apps-panel"
          label="App logs"
        />
      </Tabs>
      <Box
        role="tabpanel"
        id="logs-audit-panel"
        aria-labelledby="logs-audit-tab"
        hidden={tab !== 0}
      >
        {tab === 0 && <AuditLogPanel />}
      </Box>
      <Box
        role="tabpanel"
        id="logs-apps-panel"
        aria-labelledby="logs-apps-tab"
        hidden={tab !== 1}
      >
        {tab === 1 && <AppContainerLogPanel />}
      </Box>
    </Box>
  );
}
