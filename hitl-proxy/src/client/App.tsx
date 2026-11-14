import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { listSessions, type SessionSummary } from "./api";
import { SessionView } from "./SessionView";

const DRAWER_WIDTH = 300;

function statusColor(
  status: SessionSummary["status"],
): "default" | "warning" | "success" | "error" {
  switch (status) {
    case "pending":
      return "warning";
    case "answered":
      return "success";
    case "timeout":
      return "error";
    default:
      return "default";
  }
}

export function App() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const popup = searchParams.get("popup") === "1";
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listSessions();
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (popup) return;
    if (!sessionId && sessions.length > 0) {
      navigate(`/s/${sessions[0].id}`, { replace: true });
    }
  }, [sessionId, sessions, navigate, popup]);

  const selectedUrl = useMemo(() => {
    if (!sessionId || typeof window === "undefined") return "";
    return `${window.location.origin}/s/${sessionId}`;
  }, [sessionId]);

  const copyLink = async () => {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy link");
    }
  };

  if (popup) {
    return (
      <Box sx={{ height: "100vh", overflow: "auto", p: 2 }}>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        {sessionId ? (
          <SessionView sessionId={sessionId} onChanged={() => void load()} />
        ) : (
          <Typography color="text.secondary">No session selected.</Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          zIndex: (t) => t.zIndex.drawer + 1,
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            HITL Proxy
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            Agent ask-question relay
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            disabled={!sessionId}
            onClick={() => void copyLink()}
          >
            {copied ? "Copied" : "Copy session link"}
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: DRAWER_WIDTH,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            borderRight: 1,
            borderColor: "divider",
          },
        }}
      >
        <Toolbar sx={{ flexShrink: 0 }} />
        <Box sx={{ px: 2, py: 1.5, flexShrink: 0 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Question sessions
          </Typography>
        </Box>
        <Divider sx={{ flexShrink: 0 }} />
        <List dense sx={{ py: 0, flex: 1, overflowY: "auto", minHeight: 0 }}>
          {sessions.length === 0 && (
            <Box sx={{ px: 2, py: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Waiting for an agent to call ask_question via MCP…
              </Typography>
            </Box>
          )}
          {sessions.map((session) => (
            <ListItemButton
              key={session.id}
              selected={session.id === sessionId}
              onClick={() => navigate(`/s/${session.id}`)}
              alignItems="flex-start"
            >
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      noWrap
                      sx={{ flex: 1 }}
                    >
                      {session.title}
                    </Typography>
                    <Chip
                      size="small"
                      label={session.status}
                      color={statusColor(session.status)}
                    />
                  </Stack>
                }
                secondary={
                  <>
                    {(session.questionCount ?? 1) > 1
                      ? `${session.questionCount} questions`
                      : session.questionPreview}
                    {" · "}
                    {new Date(session.updatedAt).toLocaleString()}
                  </>
                }
              />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          height: "100vh",
          overflow: "auto",
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
        }}
      >
        <Toolbar sx={{ flexShrink: 0 }} />
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 920, pb: 4 }}>
          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}
          {sessionId ? (
            <SessionView sessionId={sessionId} onChanged={() => void load()} />
          ) : (
            <Typography color="text.secondary">
              No session selected. Agents create sessions through the HITL Proxy
              MCP tools.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
