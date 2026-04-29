import {
  app,
  type HttpHandler,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { createBacklogMcpServerFactory } from '../createBacklogMcpServerFactory.js';
import { createHttpMcpHandler } from '../httpMcpHandler.js';
import { createInMemoryHttpMcpSessionRegistry } from '../httpMcpSessionRegistry.js';
import { logger } from '../utils/logger.js';
import { toAzureHttpResponse, toFetchRequest } from './httpAdapters.js';
import packageJson from '../../package.json' with { type: 'json' };

const { version } = packageJson;
const sessionRegistry = createInMemoryHttpMcpSessionRegistry();
let handlerPromise:
  | Promise<ReturnType<typeof createHttpMcpHandler>>
  | undefined;
type Environment = Record<string, string | undefined>;

app.setup({
  enableHttpStream: true,
});

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parsePositiveInt(
  value: string | undefined,
  defaultValue: number
): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveEnabledToolsets(env: Environment): {
  dynamicToolsets: boolean;
  enabledToolsets: string[];
} {
  const dynamicToolsets = parseBoolean(env.ENABLE_DYNAMIC_TOOLSETS, false);
  const toolsets = parseCsv(env.ENABLE_TOOLSETS);
  const normalizedToolsets = toolsets.length > 0 ? toolsets : ['all'];

  return {
    dynamicToolsets,
    enabledToolsets: dynamicToolsets
      ? normalizedToolsets.filter((toolset) => toolset !== 'all')
      : normalizedToolsets,
  };
}

function resolveAllowedHosts(env: Environment): string[] | undefined {
  const explicitHosts = parseCsv(env.MCP_HTTP_ALLOWED_HOSTS);
  if (explicitHosts.length > 0) {
    return explicitHosts;
  }

  return env.WEBSITE_HOSTNAME ? [env.WEBSITE_HOSTNAME] : undefined;
}

async function getHttpHandler() {
  if (!handlerPromise) {
    handlerPromise = Promise.resolve().then(() => {
      const { dynamicToolsets, enabledToolsets } =
        resolveEnabledToolsets(process.env);
      const { createServer } = createBacklogMcpServerFactory({
        version,
        optimizeResponse: parseBoolean(process.env.OPTIMIZE_RESPONSE, false),
        maxTokens: parsePositiveInt(process.env.MAX_TOKENS, 50000),
        prefix: process.env.PREFIX ?? '',
        enabledToolsets,
        dynamicToolsets,
      });

      return createHttpMcpHandler({
        path: '/mcp',
        version,
        enableJsonResponse: parseBoolean(
          process.env.MCP_HTTP_JSON_RESPONSE,
          true
        ),
        allowedHosts: resolveAllowedHosts(process.env),
        createServer,
        sessionRegistry,
      });
    });
  }

  try {
    return await handlerPromise;
  } catch (error) {
    handlerPromise = undefined;
    throw error;
  }
}

async function handleWithSharedHandler(
  request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const handler = await getHttpHandler();
  const response = await handler.fetch(await toFetchRequest(request));
  return toAzureHttpResponse(response);
}

const healthHandler: HttpHandler = handleWithSharedHandler;
const mcpHandler: HttpHandler = handleWithSharedHandler;

const mcpMethods: HttpMethod[] = ['GET', 'POST', 'DELETE'];

app.http('health', {
  route: 'health',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: healthHandler,
});

app.http('mcp', {
  route: 'mcp',
  methods: mcpMethods,
  authLevel: 'function',
  handler: mcpHandler,
});

export async function disposeAzureFunctionHttpHandler(): Promise<void> {
  if (!handlerPromise) {
    return;
  }

  try {
    const handler = await handlerPromise;
    await handler.shutdown();
  } catch (error) {
    logger.error({ err: error }, 'Failed to dispose Azure Functions MCP handler');
  } finally {
    handlerPromise = undefined;
  }
}
