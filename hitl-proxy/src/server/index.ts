import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { createMcpHandler } from "./mcp.js";
import { SessionStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.HITL_PORT ?? process.env.PORT ?? 3877);
/** Localhost-only by default — this is a desktop companion, not a public API. */
const HOST = process.env.HITL_HOST ?? process.env.HOST ?? "127.0.0.1";
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`
).replace(/\/$/, "");
const MCP_TOKEN =
  process.env.HITL_MCP_TOKEN?.trim() ||
  process.env.MITM_MCP_TOKEN?.trim() ||
  "";
const DATA_DIR =
  process.env.HITL_DATA_DIR ??
  process.env.MITM_DATA_DIR ??
  path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "sessions.json");

const store = new SessionStore(STORE_PATH);
const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "hitl-proxy" });
});

function requireMcpAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!MCP_TOKEN) {
    res.status(503).json({ error: "HITL_MCP_TOKEN is not configured" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1] !== MCP_TOKEN) {
    res.status(401).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "Unauthorized: Bearer HITL_MCP_TOKEN required",
      },
    });
    return;
  }
  next();
}

app.all("/mcp", requireMcpAuth, createMcpHandler(store, PUBLIC_BASE_URL));

app.get("/api/sessions", (_req, res) => {
  store.sweep();
  res.json({
    sessions: store.listSessions().map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      status: store.sessionStatus(s),
      questionCount: s.questions.length,
      pendingCount: s.questions.filter((q) => q.status === "pending").length,
      questionPreview:
        s.questions.length === 1
          ? (s.questions[0]?.content?.slice(0, 120) ?? "")
          : `${s.questions.length} questions`,
    })),
  });
});

app.get("/api/sessions/:id", (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
});

app.post("/api/sessions/:id/answer", async (req, res) => {
  try {
    const questionId =
      typeof req.body?.questionId === "string"
        ? req.body.questionId
        : undefined;
    const answer = typeof req.body?.answer === "string" ? req.body.answer : "";
    const extras =
      typeof req.body?.extras === "string" ? req.body.extras : undefined;
    const selectedAnswers = Array.isArray(req.body?.selectedAnswers)
      ? (req.body.selectedAnswers as unknown[]).filter(
          (item): item is string => typeof item === "string",
        )
      : undefined;
    const session = store.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const targetId = questionId ?? session.questions[0]?.id;
    if (!targetId) {
      res.status(400).json({ error: "No question in session" });
      return;
    }
    const result = await store.answerQuestion(
      session.id,
      targetId,
      answer,
      extras,
      selectedAnswers,
    );
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to answer";
    res.status(400).json({ error: message });
  }
});

const clientDist = path.resolve(__dirname, "../client");
app.use(
  express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/mcp") ||
    req.path === "/health"
  ) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) {
      res.status(404).send("UI not built. Run npm run build.");
    }
  });
});

await store.init();
setInterval(() => store.sweep(), 5000).unref();

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`HITL Proxy service on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`MCP POST ${PUBLIC_BASE_URL}/mcp`);
});
