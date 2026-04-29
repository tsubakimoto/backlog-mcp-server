import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { logger } from './utils/logger.js';
import type { BacklogMCPServer } from './utils/wrapServerWithToolRegistry.js';
import {
  createInMemoryHttpMcpSessionRegistry,
  type HttpMcpSessionRegistry,
} from './httpMcpSessionRegistry.js';

export type CreateHttpMcpHandlerOptions = {
  path: string;
  version: string;
  enableJsonResponse: boolean;
  allowedHosts?: string[];
  createServer: () => BacklogMCPServer;
  sessionRegistry?: HttpMcpSessionRegistry;
};

export type HttpMcpHandler = {
  fetch: (request: Request) => Promise<Response>;
  shutdown: () => Promise<void>;
};

type JsonRpcErrorBody = {
  jsonrpc: '2.0';
  error: { code: number; message: string };
  id: null;
};

const jsonRpcError = (code: number, message: string): JsonRpcErrorBody => {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
};

const bodyContainsInitialize = (body: unknown): boolean => {
  return (Array.isArray(body) ? body : [body]).some(isInitializeRequest);
};

const parseHostname = (hostHeader: string): string | null => {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
};

const checkHostHeader = (
  hostHeader: string | null,
  allowedHostnames: string[]
): JsonRpcErrorBody | null => {
  if (!hostHeader) return jsonRpcError(-32000, 'Missing Host header');
  const hostname = parseHostname(hostHeader);
  if (hostname === null) {
    return jsonRpcError(-32000, `Invalid Host header: ${hostHeader}`);
  }
  return allowedHostnames.includes(hostname)
    ? null
    : jsonRpcError(-32000, `Invalid Host: ${hostname}`);
};

const startNewSession = async (
  request: Request,
  body: unknown,
  enableJsonResponse: boolean,
  sessionRegistry: HttpMcpSessionRegistry,
  createServer: () => BacklogMCPServer
): Promise<Response> => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse,
    onsessioninitialized: (sessionId) => {
      sessionRegistry.set(sessionId, transport);
    },
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) {
      sessionRegistry.delete(sessionId);
    }
  };

  await createServer().connect(transport);
  return transport.handleRequest(request, { parsedBody: body });
};

export function createHttpMcpHandler({
  path,
  version,
  enableJsonResponse,
  allowedHosts,
  createServer,
  sessionRegistry = createInMemoryHttpMcpSessionRegistry(),
}: CreateHttpMcpHandlerOptions): HttpMcpHandler {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({ status: 'healthy', timestamp: new Date().toISOString(), version })
  );

  app.all(path, async (c) => {
    const request = c.req.raw;

    if (allowedHosts) {
      const hostError = checkHostHeader(
        request.headers.get('host'),
        allowedHosts
      );
      if (hostError) return c.json(hostError, 403);
    }

    const sessionId = request.headers.get('mcp-session-id');

    try {
      const existingTransport = sessionId
        ? sessionRegistry.get(sessionId)
        : undefined;
      if (existingTransport) {
        return existingTransport.handleRequest(request);
      }

      if (sessionId) {
        return c.json(
          jsonRpcError(
            -32000,
            'Bad Request: Unknown or expired session ID. Send a new initialize request without mcp-session-id.'
          ),
          400
        );
      }

      if (request.method !== 'POST') {
        return c.json(
          jsonRpcError(-32000, 'Bad Request: No mcp-session-id header.'),
          400
        );
      }

      const parsed = await request.json().then(
        (body: unknown) => ({ body }),
        () => null
      );
      if (!parsed) {
        return c.json(jsonRpcError(-32700, 'Parse error: Invalid JSON'), 400);
      }

      if (!bodyContainsInitialize(parsed.body)) {
        const err = jsonRpcError(
          -32000,
          'Bad Request: No mcp-session-id header and body is not an initialize request.'
        );
        return c.json(Array.isArray(parsed.body) ? [err] : err, 400);
      }

      return startNewSession(
        request,
        parsed.body,
        enableJsonResponse,
        sessionRegistry,
        createServer
      );
    } catch (error) {
      logger.error({ err: error }, 'Error handling MCP request');
      return c.json(jsonRpcError(-32603, 'Internal server error'), 500);
    }
  });

  return {
    fetch: (request) => Promise.resolve(app.fetch(request)),
    shutdown: async () => {
      for (const transport of sessionRegistry.list()) {
        try {
          await transport.close();
        } catch {
          /* ignore */
        }

        const sessionId = transport.sessionId;
        if (sessionId) {
          sessionRegistry.delete(sessionId);
        }
      }
    },
  };
}

export function buildAllowedHostnames(
  host: string,
  allowedHosts?: string[]
): string[] | undefined {
  if (allowedHosts?.length) return allowedHosts;

  const localhostHosts = ['127.0.0.1', 'localhost', '::1'];
  return localhostHosts.includes(host)
    ? ['localhost', '127.0.0.1', '[::1]']
    : undefined;
}

export function normalizeHttpPath(path: string): string {
  if (path.startsWith('/')) {
    return path;
  }

  return `/${path}`;
}
