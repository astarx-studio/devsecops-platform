"use client";

import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import AppRegistrationOutlinedIcon from "@mui/icons-material/AppRegistrationOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { Box, ButtonBase, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import type { ComponentType } from "react";

import {
  CONSOLE_SECTIONS,
  type ConsoleSection,
} from "@/lib/console-sections";

interface ConsoleNavigationProps {
  section: ConsoleSection;
  onNavigate: (section: ConsoleSection) => void;
}

type IconComponent = ComponentType<{ sx?: object }>;

const groups: Array<{
  label: string;
  items: Array<{ id: ConsoleSection; icon: IconComponent }>;
}> = [
  {
    label: "Workspace",
    items: [
      { id: "overview", icon: GridViewOutlinedIcon },
      { id: "projects", icon: FolderOutlinedIcon },
    ],
  },
  {
    label: "Provisioning",
    items: [
      { id: "create", icon: AddOutlinedIcon },
      { id: "register", icon: AppRegistrationOutlinedIcon },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "logs", icon: HistoryOutlinedIcon },
      { id: "mcp", icon: KeyOutlinedIcon },
    ],
  },
];

function ProductMark() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 34,
        height: 34,
        position: "relative",
        flexShrink: 0,
      }}
    >
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{
            position: "absolute",
            left: 3 + index * 3,
            top: 3 + index * 6,
            width: 24,
            height: 12,
            border: "1.5px solid",
            borderColor: index === 2 ? "#69d2c5" : "#a8b9c2",
            borderRadius: "3px",
            transform: "skewY(-12deg)",
            bgcolor: index === 2 ? "rgba(105,210,197,0.12)" : "transparent",
          }}
        />
      ))}
    </Box>
  );
}

export function ConsoleNavigation({
  section,
  onNavigate,
}: ConsoleNavigationProps) {
  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: "#142129",
        color: "#edf3f5",
      }}
    >
      <ButtonBase
        onClick={() => onNavigate("overview")}
        aria-label="DSOaaS overview"
        sx={{
          minHeight: 72,
          px: 2.5,
          justifyContent: "flex-start",
          textAlign: "left",
          gap: 1.25,
          borderBottom: "1px solid rgba(224,238,242,0.1)",
          "&:hover": { bgcolor: "rgba(255,255,255,0.035)" },
        }}
      >
        <ProductMark />
        <Box>
          <Typography
            sx={{ fontSize: 19, lineHeight: 1.2, fontWeight: 600, letterSpacing: 0.2 }}
          >
            DSOaaS
          </Typography>
          <Typography
            sx={{
              mt: 0.35,
              color: "#9fb0ba",
              fontSize: 11,
              lineHeight: 1,
              fontWeight: 500,
              letterSpacing: 1.25,
              textTransform: "uppercase",
            }}
          >
            Control plane
          </Typography>
        </Box>
      </ButtonBase>

      <Box component="nav" aria-label="Console navigation" sx={{ flex: 1, overflowY: "auto", py: 2 }}>
        {groups.map((group) => (
          <Box key={group.label} sx={{ mb: 1.5 }}>
            <Typography
              sx={{
                px: 3,
                pb: 0.75,
                color: "#8fa2ad",
                fontSize: 11,
                lineHeight: 1.5,
                fontWeight: 600,
                letterSpacing: 1.1,
                textTransform: "uppercase",
              }}
            >
              {group.label}
            </Typography>
            <List disablePadding>
              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = section === item.id;
                return (
                  <ListItem key={item.id} disablePadding sx={{ display: "block" }}>
                    <ListItemButton
                      selected={selected}
                      onClick={() => onNavigate(item.id)}
                      aria-current={selected ? "page" : undefined}
                      sx={{
                        minHeight: 44,
                        mx: 1.25,
                        mb: 0.25,
                        px: 1.5,
                        borderRadius: 1,
                        color: selected ? "#f4fafa" : "#b7c4cb",
                        bgcolor: selected ? "rgba(105,210,197,0.12)" : "transparent",
                        "& .MuiListItemIcon-root": {
                          color: selected ? "#75d8ca" : "#91a4af",
                        },
                        "&:hover": {
                          bgcolor: selected
                            ? "rgba(105,210,197,0.16)"
                            : "rgba(255,255,255,0.05)",
                        },
                        "&.Mui-selected": {
                          bgcolor: "rgba(105,210,197,0.12)",
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 34 }}>
                        <Icon sx={{ fontSize: 20 }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={CONSOLE_SECTIONS[item.id].shortTitle}
                        primaryTypographyProps={{
                          fontSize: 14,
                          fontWeight: selected ? 600 : 450,
                        }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Box sx={{ m: 1.5, p: 1.5, border: "1px solid rgba(224,238,242,0.11)", borderRadius: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#75d8ca" }} />
          <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
            Self-hosted workspace
          </Typography>
        </Box>
        <Typography sx={{ mt: 0.5, color: "#9fb0ba", fontSize: 12, lineHeight: 1.5 }}>
          DevSecOps operations and administration
        </Typography>
      </Box>
    </Box>
  );
}
