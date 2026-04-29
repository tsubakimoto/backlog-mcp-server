import type { Backlog } from 'backlog-js';
import { createBacklogMcpServer } from './createBacklogMcpServer.js';
import {
  createTranslationHelper,
  type TranslationHelper,
} from './createTranslationHelper.js';
import type { MCPOptions } from './types/mcp.js';
import {
  createBacklogClientRegistry,
  type BacklogClientRegistry,
} from './utils/backlogClientRegistry.js';
import type { BacklogMCPServer } from './utils/wrapServerWithToolRegistry.js';

export type CreateBacklogMcpServerFactoryConfig = {
  version: string;
  optimizeResponse: boolean;
  maxTokens: number;
  prefix: string;
  enabledToolsets: string[];
  dynamicToolsets: boolean;
  clientRegistry?: BacklogClientRegistry;
  backlog?: Backlog;
  transHelper?: TranslationHelper;
};

export type BacklogMcpServerFactory = {
  clientRegistry: BacklogClientRegistry;
  backlog: Backlog;
  transHelper: TranslationHelper;
  mcpOption: MCPOptions;
  createServer: () => BacklogMCPServer;
};

export function createBacklogMcpServerFactory({
  version,
  optimizeResponse,
  maxTokens,
  prefix,
  enabledToolsets,
  dynamicToolsets,
  clientRegistry = createBacklogClientRegistry(),
  backlog = clientRegistry.createScopedClient(),
  transHelper = createTranslationHelper(),
}: CreateBacklogMcpServerFactoryConfig): BacklogMcpServerFactory {
  const mcpOption: MCPOptions = {
    useFields: optimizeResponse,
    maxTokens,
    prefix,
  };

  return {
    clientRegistry,
    backlog,
    transHelper,
    mcpOption,
    createServer: () =>
      createBacklogMcpServer({
        version,
        useFields: optimizeResponse,
        backlog,
        clientRegistry,
        transHelper,
        enabledToolsets,
        mcpOption,
        dynamicToolsets,
      }),
  };
}
