// Copyright (c) 2025 Nulab inc.
// Licensed under the MIT License.

import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import {
  buildAllowedHostnames,
  createHttpMcpHandler,
} from './httpMcpHandler.js';
import { logger } from './utils/logger.js';
import type { BacklogMCPServer } from './utils/wrapServerWithToolRegistry.js';

type RunHttpMcpServerOptions = {
  host: string;
  port: number;
  path: string;
  version: string;
  enableJsonResponse: boolean;
  allowedHosts?: string[];
  createServer: () => BacklogMCPServer;
};

type HttpMcpServerHandle = {
  httpServer: Server;
  shutdown: () => Promise<void>;
};

export const runHttpMcpServer = async (
  options: RunHttpMcpServerOptions
): Promise<HttpMcpServerHandle> => {
  const {
    host,
    port,
    path: mcpPath,
    version,
    enableJsonResponse,
    allowedHosts,
    createServer,
  } = options;

  if ((host === '0.0.0.0' || host === '::') && !allowedHosts?.length) {
    logger.warn(
      'Binding to all interfaces without --http-allowed-hosts. ' +
        'Set allowed Host values to prevent DNS rebinding attacks.'
    );
  }

  const handler = createHttpMcpHandler({
    path: mcpPath,
    version,
    enableJsonResponse,
    allowedHosts: buildAllowedHostnames(host, allowedHosts),
    createServer,
  });

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const srv = serve({ fetch: handler.fetch, port, hostname: host }, () =>
      resolve(srv as Server)
    );
    srv.on('error', reject);
  });

  const shutdown = async () => {
    await handler.shutdown();
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { httpServer, shutdown };
};
