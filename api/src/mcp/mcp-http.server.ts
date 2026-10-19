import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { auditActorAls } from '../common/audit/audit-actor.context';
import type { AppConfiguration } from '../config';
import { McpAccessKeyService } from './mcp-access-key.service';
import { handleMcpBody } from './mcp-protocol';
import { McpToolService } from './mcp-tools';

const MAX_BODY = 1024 * 1024;

/**
 * Dedicated listener so MCP can be published on the LAN without also publishing GraphQL.
 * Only issued `dsoas_` keys authenticate. The platform API_KEY is rejected.
 */
@Injectable()
export class McpHttpServer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpHttpServer.name);
  private server?: Server;
  private readonly sseKeepalives = new Set<ReturnType<typeof setInterval>>();

  constructor(
    private readonly config: ConfigService<AppConfiguration>,
    private readonly keys: McpAccessKeyService,
    private readonly tools: McpToolService,
  ) {}

  onModuleInit(): void {
    const port = this.config.get('mcp.port', { infer: true }) ?? 13010;
    const host = this.config.get('mcp.host', { infer: true }) ?? '0.0.0.0';
    if (port === 0) {
      this.logger.warn('MCP listener disabled (MCP_PORT=0)');
      return;
    }
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.listen(port, host, () => {
      this.logger.log(`DSOaaS MCP listening on ${host}:${port}/mcp`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.sseKeepalives) {
      clearInterval(timer);
    }
    this.sseKeepalives.clear();
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        const body = await this.tools.call('platform_health', {}, 'read');
        sendJson(res, 200, body);
        return;
      }
      if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method === 'GET') {
        const key = await this.authenticate(req, res);
        if (!key) {
          return;
        }
        this.openSse(req, res);
        return;
      }
      if (req.method === 'DELETE') {
        sendJson(res, 405, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Use POST /mcp with a DSOaaS access key' },
        });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const key = await this.authenticate(req, res);
      if (!key) {
        return;
      }

      const raw = await readBody(req);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        });
        return;
      }

      const result = await auditActorAls.run({ actor: `mcp:${key.tokenPrefix}` }, () =>
        handleMcpBody(payload, this.tools, key.scope),
      );
      if (result.body === undefined) {
        res.writeHead(result.status);
        res.end();
        return;
      }
      sendJson(res, result.status, result.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${(error as Error).message}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'MCP request failed' });
      }
    }
  }

  private async authenticate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<
    { tokenPrefix: string; scope: 'read' | 'read_secret' | 'operate' | 'full' } | undefined
  > {
    const token = bearerToken(req);
    if (!token) {
      sendJson(res, 401, { error: 'Authorization: Bearer dsoas_… required' });
      return undefined;
    }
    const key = await this.keys.authenticate(token);
    if (!key) {
      sendJson(res, 401, { error: 'Invalid or revoked MCP access key' });
      return undefined;
    }
    return key;
  }

  /**
   * Cursor's streamable HTTP client opens GET /mcp before tools/list.
   * A 405 made it keep the previous tool snapshot. An idle SSE stream lets that POST happen.
   */
  private openSse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write(': dsoaas mcp\n\n');
    const timer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 15000);
    this.sseKeepalives.add(timer);
    const close = () => {
      clearInterval(timer);
      this.sseKeepalives.delete(timer);
    };
    req.on('close', close);
    res.on('close', close);
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  const headerKey = req.headers['x-api-key'];
  return typeof headerKey === 'string' ? headerKey.trim() : undefined;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('MCP body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
