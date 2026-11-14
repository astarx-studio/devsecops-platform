/**
 * stdio MCP bridge → local HITL Proxy HTTP /mcp.
 * Cursor launches this process; the Windows service owns session state.
 */
import process from "node:process";

const MCP_URL = (
  process.env.HITL_MCP_URL ?? "http://127.0.0.1:3877/mcp"
).replace(/\/$/, "");
const TOKEN =
  process.env.HITL_MCP_TOKEN?.trim() ||
  process.env.MITM_MCP_TOKEN?.trim() ||
  "";

function writeFramed(message: unknown): void {
  const json = JSON.stringify(message);
  const payload = Buffer.from(
    `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`,
    "utf8",
  );
  process.stdout.write(payload);
}

async function forward(body: unknown): Promise<unknown | undefined> {
  if (!TOKEN) {
    return {
      jsonrpc: "2.0",
      id: (body as { id?: unknown })?.id ?? null,
      error: {
        code: -32000,
        message: "HITL_MCP_TOKEN is not set for the stdio bridge",
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const text =
      error instanceof Error ? error.message : "HITL Proxy service unreachable";
    return {
      jsonrpc: "2.0",
      id: (body as { id?: unknown })?.id ?? null,
      error: {
        code: -32000,
        message: `HITL Proxy service unreachable (${MCP_URL}): ${text}. Is the HITL Proxy Windows service running?`,
      },
    };
  }

  if (res.status === 202) {
    return undefined;
  }

  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      jsonrpc: "2.0",
      id: (body as { id?: unknown })?.id ?? null,
      error: { code: -32603, message: `Bad MCP HTTP response (${res.status})` },
    };
  }
}

async function handleIncoming(raw: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    writeFramed({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    return;
  }

  if (Array.isArray(payload)) {
    const out: unknown[] = [];
    for (const item of payload) {
      const response = await forward(item);
      if (response !== undefined) out.push(response);
    }
    if (out.length > 0) {
      writeFramed(out.length === 1 ? out[0] : out);
    }
    return;
  }

  const response = await forward(payload);
  if (response !== undefined) {
    writeFramed(response);
  }
}

async function main(): Promise<void> {
  let buffer = Buffer.alloc(0);
  let ended = false;
  let pumping = false;

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    void pump();
  });

  process.stdin.on("end", () => {
    ended = true;
    void pump();
  });

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          // Fallback: newline-delimited JSON (one object per line).
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.subarray(0, nl).toString("utf8").trim();
          buffer = buffer.subarray(nl + 1);
          if (line) await handleIncoming(line);
          continue;
        }

        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.subarray(0, nl).toString("utf8").trim();
          buffer = buffer.subarray(nl + 1);
          if (line) await handleIncoming(line);
          continue;
        }

        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) break;

        const body = buffer
          .subarray(bodyStart, bodyStart + length)
          .toString("utf8");
        buffer = buffer.subarray(bodyStart + length);
        await handleIncoming(body);
      }
    } finally {
      pumping = false;
    }

    if (ended && buffer.length === 0 && !pumping) {
      process.exit(0);
    }
  }
}

void main();
