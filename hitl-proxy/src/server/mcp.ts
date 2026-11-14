import type { Request, Response } from "express";

import type { SessionStore } from "./store.js";

const SUPPORTED_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const DEFAULT_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "ask_question",
    description:
      'Create one human-in-the-loop session (replaces Cursor AskQuestion). Pass a single question, or questions[] for multiple in the SAME session. A final optional step is always appended: "Do you have anything else to tell the agent?" (may be empty). Poll get_answer / wait_for_answer with sessionId until nothing is pending.',
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Single question text. Ignored when questions[] is provided.",
        },
        answers: {
          type: "array",
          items: { type: "string" },
          description:
            "Predefined chips for a single question. Ignored when questions[] is provided.",
        },
        allowMultiple: {
          type: "boolean",
          description:
            "Multi-select chips for a single question. Ignored when questions[] is provided.",
        },
        questions: {
          type: "array",
          description:
            "Multiple questions in one session (preferred for batches). Max 20.",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
              allowMultiple: { type: "boolean" },
            },
            required: ["question"],
            additionalProperties: false,
          },
        },
        timeoutSeconds: {
          type: "integer",
          minimum: 5,
          maximum: 3600,
          description:
            "Seconds before pending questions become timeout (default 1800 / 30m, max 3600). Session deleted after 1 hour.",
        },
        title: {
          type: "string",
          description:
            'Sidebar title; defaults to the question text or "N questions"',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_answer",
    description:
      "Get status/answers. With sessionId (no questionId): returns all questions and aggregate status (pending while any are unanswered). With questionId: returns that question only.",
    inputSchema: {
      type: "object",
      properties: {
        questionId: { type: "string" },
        sessionId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_answer",
    description:
      "Block briefly while polling. Prefer sessionId so a multi-question session completes together. Prefer short maxWaitMs (e.g. 25000) and retry if still pending.",
    inputSchema: {
      type: "object",
      properties: {
        questionId: { type: "string" },
        sessionId: { type: "string" },
        maxWaitMs: {
          type: "integer",
          minimum: 1000,
          maximum: 60000,
          description:
            "How long this call may block (default 20000, max 60000)",
        },
        pollIntervalMs: {
          type: "integer",
          minimum: 250,
          maximum: 5000,
          description: "Poll interval (default 1000)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_sessions",
    description: "List recent HITL Proxy question sessions (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
  };
}

export function createMcpHandler(store: SessionStore, publicBaseUrl: string) {
  return async (req: Request, res: Response): Promise<void> => {
    if (req.method === "GET") {
      res.status(405).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Use POST /mcp with Bearer token" },
      });
      return;
    }

    const payload = req.body as unknown;
    const result = await handleMcpBody(payload, store, publicBaseUrl);
    if (result.body === undefined) {
      res.status(result.status).end();
      return;
    }
    res.status(result.status).json(result.body);
  };
}

async function handleMcpBody(
  payload: unknown,
  store: SessionStore,
  publicBaseUrl: string,
): Promise<{ status: number; body?: unknown }> {
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      const one = await handleOne(item, store, publicBaseUrl);
      if (one.body !== undefined) {
        responses.push(one.body);
      }
    }
    if (responses.length === 0) {
      return { status: 202 };
    }
    return { status: 200, body: responses };
  }
  return handleOne(payload, store, publicBaseUrl);
}

async function handleOne(
  payload: unknown,
  store: SessionStore,
  publicBaseUrl: string,
): Promise<{ status: number; body?: unknown }> {
  if (!payload || typeof payload !== "object") {
    return rpcError(null, -32600, "Invalid request");
  }
  const message = payload as JsonRpcRequest;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message.id ?? null, -32600, "Invalid request");
  }

  const notification = !Object.prototype.hasOwnProperty.call(message, "id");
  try {
    const result = await dispatch(message, store, publicBaseUrl);
    if (notification) {
      return { status: 202 };
    }
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result } };
  } catch (error) {
    if (notification) {
      return { status: 202 };
    }
    const text = error instanceof Error ? error.message : "Tool failed";
    if (
      text.startsWith("Unknown tool") ||
      text.startsWith("Method not found")
    ) {
      return rpcError(message.id ?? null, -32601, text);
    }
    if (message.method === "tools/call") {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text }], isError: true },
        },
      };
    }
    return rpcError(message.id ?? null, -32603, text);
  }
}

async function dispatch(
  message: JsonRpcRequest,
  store: SessionStore,
  publicBaseUrl: string,
): Promise<unknown> {
  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      const protocolVersion =
        requested && SUPPORTED_VERSIONS.includes(requested)
          ? requested
          : DEFAULT_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "hitl-proxy", version: "1.0.0" },
        instructions:
          "Human-in-the-loop ask_question for Cursor agents (HITL Proxy). Call ask_question, then wait_for_answer or poll get_answer. On timeout, the desktop tray UI still accepts answers within 1 hour; call get_answer later with the same sessionId.",
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return undefined;
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = message.params?.name;
      if (!name) {
        throw new Error("tools/call requires a tool name");
      }
      const args = message.params?.arguments ?? {};
      const data = await callTool(name, args, store, publicBaseUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
    default:
      throw new Error(`Method not found: ${message.method}`);
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  store: SessionStore,
  publicBaseUrl: string,
): Promise<unknown> {
  switch (name) {
    case "ask_question": {
      const timeoutSeconds =
        typeof args.timeoutSeconds === "number"
          ? args.timeoutSeconds
          : undefined;
      const title = optionalString(args, "title");
      const items = parseQuestionItems(args);
      const { session, questions } = await store.askQuestions({
        items,
        timeoutSeconds,
        title,
      });
      const base = publicBaseUrl.replace(/\/$/, "");
      return {
        sessionId: session.id,
        url: `${base}/s/${session.id}`,
        title: session.title,
        status: store.sessionStatus(session),
        questionCount: questions.length,
        questionId: questions[0]?.id,
        questionIds: questions.map((q) => q.id),
        expiresAt: questions[0]?.expiresAt,
        questions: questions.map((q) => ({
          questionId: q.id,
          question: q.content,
          allowMultiple: q.allowMultiple === true,
          optional: q.optional === true,
          predefinedAnswers: q.predefinedAnswers,
          status: q.status,
          expiresAt: q.expiresAt,
        })),
      };
    }
    case "get_answer":
      return resolveAnswer(store, args, publicBaseUrl);
    case "wait_for_answer": {
      const maxWaitMs = clampInt(args.maxWaitMs, 20000, 1000, 60000);
      const pollIntervalMs = clampInt(args.pollIntervalMs, 1000, 250, 5000);
      const deadline = Date.now() + maxWaitMs;
      for (;;) {
        const current = resolveAnswer(store, args, publicBaseUrl);
        if (current.status !== "pending") {
          return current;
        }
        if (Date.now() >= deadline) {
          return {
            ...current,
            waitedMs: maxWaitMs,
            note: "still pending; poll again or share url",
          };
        }
        await sleep(Math.min(pollIntervalMs, deadline - Date.now()));
      }
    }
    case "list_sessions": {
      const limit = clampInt(args.limit, 20, 1, 100);
      return {
        sessions: store
          .listSessions()
          .slice(0, limit)
          .map((s) => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            status: store.sessionStatus(s),
            questionCount: s.questions.length,
            questionId: s.questions[0]?.id,
            pendingCount: s.questions.filter((q) => q.status === "pending")
              .length,
          })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function parseQuestionItems(args: Record<string, unknown>) {
  if (Array.isArray(args.questions) && args.questions.length > 0) {
    return args.questions.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`questions[${index}] must be an object`);
      }
      const row = raw as Record<string, unknown>;
      return {
        question: requiredString(row, "question"),
        answers: stringList(row.answers),
        allowMultiple: row.allowMultiple === true,
      };
    });
  }
  if (typeof args.question === "string" && args.question.trim().length > 0) {
    return [
      {
        question: args.question.trim(),
        answers: stringList(args.answers),
        allowMultiple: args.allowMultiple === true,
      },
    ];
  }
  throw new Error("Provide question or a non-empty questions array");
}

function summarizeQuestion(question: {
  id: string;
  content: string;
  predefinedAnswers: string[];
  allowMultiple?: boolean;
  optional?: boolean;
  status: string;
  answer?: string;
  selectedAnswers?: string[];
  extras?: string;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string;
}) {
  return {
    questionId: question.id,
    question: question.content,
    predefinedAnswers: question.predefinedAnswers,
    allowMultiple: question.allowMultiple === true,
    optional: question.optional === true,
    status: question.status,
    answer: question.answer ?? null,
    selectedAnswers: question.selectedAnswers ?? null,
    extras: question.extras ?? null,
    createdAt: question.createdAt,
    expiresAt: question.expiresAt,
    answeredAt: question.answeredAt ?? null,
  };
}

function resolveAnswer(
  store: SessionStore,
  args: Record<string, unknown>,
  publicBaseUrl: string,
) {
  const questionId = optionalString(args, "questionId");
  const sessionId = optionalString(args, "sessionId");
  if (!questionId && !sessionId) {
    throw new Error("Provide questionId or sessionId");
  }

  const base = publicBaseUrl.replace(/\/$/, "");

  if (questionId) {
    const found = store.getQuestion(questionId);
    if (!found) {
      throw new Error("Question not found");
    }
    const { session, question } = found;
    return {
      sessionId: session.id,
      url: `${base}/s/${session.id}`,
      title: session.title,
      questionCount: session.questions.length,
      ...summarizeQuestion(question),
    };
  }

  const session = store.getSession(sessionId!);
  if (!session) {
    throw new Error("Session not found");
  }
  const pendingCount = session.questions.filter(
    (q) => q.status === "pending",
  ).length;
  return {
    sessionId: session.id,
    url: `${base}/s/${session.id}`,
    title: session.title,
    status: store.sessionStatus(session),
    questionCount: session.questions.length,
    pendingCount,
    answeredCount: session.questions.filter((q) => q.status === "answered")
      .length,
    questions: session.questions.map(summarizeQuestion),
  };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return {
    status: 200 as const,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  };
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("answers must be a string array");
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`answers[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
