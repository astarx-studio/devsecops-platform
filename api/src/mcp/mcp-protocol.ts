import { toolsForScope, type McpToolService } from './mcp-tools';
import { scopeInstructions, type McpScope } from './mcp-scopes';

const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const DEFAULT_VERSION = '2025-03-26';

export interface McpHttpResult {
  status: number;
  body?: unknown;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

/**
 * Stateless MCP (streamable HTTP JSON) for initialize, tools/list, and tools/call.
 * Notifications with no id produce an empty 202 when they are the whole body.
 */
export async function handleMcpBody(
  payload: unknown,
  tools: Pick<McpToolService, 'call'>,
  scope: McpScope = 'read',
): Promise<McpHttpResult> {
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      const one = await handleOne(item, tools, scope);
      if (one.body !== undefined) {
        responses.push(one.body);
      }
    }
    if (responses.length === 0) {
      return { status: 202 };
    }
    return { status: 200, body: responses };
  }
  return handleOne(payload, tools, scope);
}

async function handleOne(
  payload: unknown,
  tools: Pick<McpToolService, 'call'>,
  scope: McpScope,
): Promise<McpHttpResult> {
  if (!payload || typeof payload !== 'object') {
    return rpcError(null, -32600, 'Invalid request');
  }
  const message = payload as JsonRpcRequest;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message.id ?? null, -32600, 'Invalid request');
  }

  const notification = !Object.prototype.hasOwnProperty.call(message, 'id');
  try {
    const result = await dispatch(message, tools, scope);
    if (notification) {
      return { status: 202 };
    }
    return { status: 200, body: { jsonrpc: '2.0', id: message.id, result } };
  } catch (error) {
    if (notification) {
      return { status: 202 };
    }
    const text = error instanceof Error ? error.message : 'Tool failed';
    if (text.startsWith('Unknown tool') || text.startsWith('Method not found')) {
      return rpcError(message.id ?? null, -32601, text);
    }
    if (message.method === 'tools/call') {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text }], isError: true },
        },
      };
    }
    return rpcError(message.id ?? null, -32603, text);
  }
}

async function dispatch(
  message: JsonRpcRequest,
  tools: Pick<McpToolService, 'call'>,
  scope: McpScope,
): Promise<unknown> {
  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      const protocolVersion =
        requested && SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'dsoaas', version: '1.1.0' },
        instructions: `${scopeInstructions(scope)} Access level: ${scope}. Keys are issued in the operator console.`,
      };
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: toolsForScope(scope) };
    case 'tools/call': {
      const name = message.params?.name;
      if (!name) {
        throw new Error('tools/call requires a tool name');
      }
      const args = message.params?.arguments ?? {};
      const data = await tools.call(name, args, scope);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    default:
      throw new Error(`Method not found: ${message.method}`);
  }
}

function rpcError(id: string | number | null, code: number, message: string): McpHttpResult {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id, error: { code, message } },
  };
}
