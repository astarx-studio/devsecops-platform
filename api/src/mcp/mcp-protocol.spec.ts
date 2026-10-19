import { handleMcpBody } from './mcp-protocol';
import { toolsForScope } from './mcp-tools';

describe('handleMcpBody', () => {
  const tools = {
    call: jest.fn(async (name: string) => ({ tool: name })),
  };

  beforeEach(() => {
    tools.call.mockClear();
  });

  it('answers initialize with a read-only tool capability', async () => {
    const result = await handleMcpBody(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      },
      tools,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'dsoaas' },
        capabilities: { tools: { listChanged: true } },
      },
    });
  });

  it('lists tools and calls one', async () => {
    const listed = await handleMcpBody(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      tools,
      'read',
    );
    const names = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (tool) => tool.name,
    );
    expect(names).toEqual(toolsForScope('read').map((tool) => tool.name));
    expect(names).not.toContain('get_env_profile_content');
    expect(names).not.toContain('create_project');
    expect(names).not.toContain('delete_project');

    const called = await handleMcpBody(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'platform_health', arguments: {} },
      },
      tools,
    );
    expect(tools.call).toHaveBeenCalledWith('platform_health', {}, 'read');
    const body = called.body as { result: { content: Array<{ text: string }> } };
    expect(body.result.content[0]?.text).toContain('platform_health');
  });

  it('accepts the initialized notification without a body', async () => {
    const result = await handleMcpBody(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      tools,
    );
    expect(result).toEqual({ status: 202 });
  });

  it('hides destructive tools from a read key and refuses the call', async () => {
    const listed = await handleMcpBody(
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      tools,
      'full',
    );
    const names = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (tool) => tool.name,
    );
    expect(names).toContain('delete_project');
    expect(names).toContain('create_project');
    expect(names).toContain('delete_template');
    expect(names).toContain('set_hostname');

    tools.call.mockRejectedValueOnce(
      new Error('Insufficient MCP scope: delete_project requires full'),
    );
    const denied = await handleMcpBody(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'delete_project', arguments: { id: 'x' } },
      },
      tools,
      'read',
    );
    expect(denied.body).toMatchObject({ result: { isError: true } });
  });

  it('returns a tool error when arguments are incomplete', async () => {
    tools.call.mockRejectedValueOnce(new Error('Provide exactly one of id, gitlabPath, or slug'));
    const result = await handleMcpBody(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_project', arguments: {} },
      },
      tools,
    );
    expect(result.body).toMatchObject({
      result: { isError: true },
    });
  });
});
