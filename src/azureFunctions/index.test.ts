import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const registeredRoutes = new Map<string, { handler: (...args: any[]) => any }>();
  const app = {
    setup: vi.fn(),
    http: vi.fn((name: string, config: { handler: (...args: any[]) => any }) => {
      registeredRoutes.set(name, config);
    }),
  };
  const createServer = vi.fn(() => ({ connect: vi.fn() }));
  const createBacklogMcpServerFactory = vi.fn(() => ({ createServer }));
  const fetch = vi.fn(async () =>
    new Response('ok', {
      status: 202,
      headers: { 'content-type': 'text/plain', 'x-test': '1' },
    })
  );
  const shutdown = vi.fn(async () => undefined);
  const createHttpMcpHandler = vi.fn(() => ({ fetch, shutdown }));
  const logger = {
    error: vi.fn(),
  };

  return {
    app,
    createBacklogMcpServerFactory,
    createHttpMcpHandler,
    createServer,
    fetch,
    logger,
    registeredRoutes,
    shutdown,
  };
});

vi.mock('@azure/functions', () => ({
  app: mocks.app,
}));

vi.mock('../createBacklogMcpServerFactory.js', () => ({
  createBacklogMcpServerFactory: mocks.createBacklogMcpServerFactory,
}));

vi.mock('../httpMcpHandler.js', () => ({
  createHttpMcpHandler: mocks.createHttpMcpHandler,
}));

vi.mock('../utils/logger.js', () => ({
  logger: mocks.logger,
}));

function createAzureHttpRequest(url: string, method = 'GET') {
  return {
    method,
    url,
    headers: new globalThis.Headers(),
    body: undefined,
    text: vi.fn(),
  } as any;
}

describe('Azure Functions MCP entrypoint', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.registeredRoutes.clear();
    process.env = { ...originalEnv };
  });

  it('reuses one shared HTTP handler across Azure Function routes', async () => {
    await import('./index.js');

    const healthHandler = mocks.registeredRoutes.get('health')?.handler;
    const mcpHandler = mocks.registeredRoutes.get('mcp')?.handler;

    expect(healthHandler).toBeTypeOf('function');
    expect(mcpHandler).toBeTypeOf('function');

    await healthHandler?.(createAzureHttpRequest('https://example.com/health'), {});
    await mcpHandler?.(createAzureHttpRequest('https://example.com/mcp'), {});

    expect(mocks.createBacklogMcpServerFactory).toHaveBeenCalledTimes(1);
    expect(mocks.createHttpMcpHandler).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses WEBSITE_HOSTNAME as the default allowed host list', async () => {
    process.env.WEBSITE_HOSTNAME = 'example.azurewebsites.net';

    await import('./index.js');

    const mcpHandler = mocks.registeredRoutes.get('mcp')?.handler;
    await mcpHandler?.(createAzureHttpRequest('https://example.com/mcp'), {});

    expect(mocks.createHttpMcpHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedHosts: ['example.azurewebsites.net'],
      })
    );
  });

  it('defaults MCP_HTTP_JSON_RESPONSE to true on Azure Functions', async () => {
    delete process.env.MCP_HTTP_JSON_RESPONSE;

    await import('./index.js');

    const mcpHandler = mocks.registeredRoutes.get('mcp')?.handler;
    await mcpHandler?.(createAzureHttpRequest('https://example.com/mcp'), {});

    expect(mocks.createHttpMcpHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        enableJsonResponse: true,
      })
    );
  });

  it('disposes the shared handler and recreates it on the next request', async () => {
    const module = await import('./index.js');

    const mcpHandler = mocks.registeredRoutes.get('mcp')?.handler;
    await mcpHandler?.(createAzureHttpRequest('https://example.com/mcp'), {});

    await module.disposeAzureFunctionHttpHandler();

    expect(mocks.shutdown).toHaveBeenCalledTimes(1);

    await mcpHandler?.(createAzureHttpRequest('https://example.com/mcp'), {});

    expect(mocks.createHttpMcpHandler).toHaveBeenCalledTimes(2);
  });
});
