import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogMCPServer } from './utils/wrapServerWithToolRegistry.js';
import { createHttpMcpHandler } from './httpMcpHandler.js';

type MockTransportOptions = {
  sessionIdGenerator: () => string;
  enableJsonResponse: boolean;
  onsessioninitialized?: (sessionId: string) => void;
};

const { transportInstances, MockStreamableHttpTransport } = vi.hoisted(() => {
  const transportInstances: Array<{
    sessionId?: string;
    onclose?: () => void;
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  class MockStreamableHttpTransport {
    sessionId?: string;
    onclose?: () => void;
    readonly handleRequest = vi.fn(
      async (request: Request, init?: { parsedBody?: unknown }) => {
        if (init?.parsedBody) {
          const body = init.parsedBody as { id?: number | string | null };
          this.sessionId = this.options.sessionIdGenerator();
          this.options.onsessioninitialized?.(this.sessionId);
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id ?? null,
              result: { initialized: true },
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'mcp-session-id': this.sessionId,
              },
            }
          );
        }

        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: request.method }] },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      }
    );

    readonly close = vi.fn(async () => {
      this.onclose?.();
    });

    constructor(private readonly options: MockTransportOptions) {
      transportInstances.push(this);
    }
  }

  return { transportInstances, MockStreamableHttpTransport };
});

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: MockStreamableHttpTransport,
}));

describe('createHttpMcpHandler', () => {
  const connect = vi.fn(async () => undefined);
  const createServer = vi.fn(
    () =>
      ({
        connect,
      }) as unknown as BacklogMCPServer
  );

  beforeEach(() => {
    connect.mockClear();
    createServer.mockClear();
    transportInstances.length = 0;
  });

  it('returns a health response without creating an MCP session', async () => {
    const handler = createHttpMcpHandler({
      path: '/mcp',
      version: '1.2.3',
      enableJsonResponse: true,
      createServer,
    });

    const response = await handler.fetch(
      new Request('http://localhost/health', { method: 'GET' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'healthy',
      version: '1.2.3',
    });
    expect(createServer).not.toHaveBeenCalled();
  });

  it('creates a new session for an initialize request', async () => {
    const handler = createHttpMcpHandler({
      path: '/mcp',
      version: '1.2.3',
      enableJsonResponse: true,
      createServer,
    });

    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '1.0.0' },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toMatch(
      /^[0-9a-f-]{36}$/i
    );
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { initialized: true },
    });
    expect(createServer).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(transportInstances).toHaveLength(1);
  });

  it('routes subsequent MCP requests through the existing session transport', async () => {
    const handler = createHttpMcpHandler({
      path: '/mcp',
      version: '1.2.3',
      enableJsonResponse: true,
      createServer,
    });

    const initializeResponse = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '1.0.0' },
          },
        }),
      })
    );
    const sessionId = initializeResponse.headers.get('mcp-session-id');

    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_project_list', arguments: {} },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'POST' }] },
    });
    expect(transportInstances[0]?.handleRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown session ids', async () => {
    const handler = createHttpMcpHandler({
      path: '/mcp',
      version: '1.2.3',
      enableJsonResponse: true,
      createServer,
    });

    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'missing-session',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_project_list', arguments: {} },
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: expect.stringContaining('Unknown or expired session ID'),
      },
    });
  });

  it('validates host headers when allowed hosts are configured', async () => {
    const handler = createHttpMcpHandler({
      path: '/mcp',
      version: '1.2.3',
      enableJsonResponse: true,
      allowedHosts: ['allowed.example.com'],
      createServer,
    });

    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          host: 'denied.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '1.0.0' },
          },
        }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Invalid Host: denied.example.com' },
    });
  });
});
