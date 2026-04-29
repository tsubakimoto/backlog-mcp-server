import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export type HttpMcpSessionTransport = Pick<
  WebStandardStreamableHTTPServerTransport,
  'close' | 'handleRequest' | 'onclose' | 'sessionId'
>;

export type HttpMcpSessionRegistry = {
  get: (sessionId: string) => HttpMcpSessionTransport | undefined;
  set: (sessionId: string, transport: HttpMcpSessionTransport) => void;
  delete: (sessionId: string) => void;
  list: () => HttpMcpSessionTransport[];
};

export function createInMemoryHttpMcpSessionRegistry(): HttpMcpSessionRegistry {
  const sessions = new Map<string, HttpMcpSessionTransport>();

  return {
    get: (sessionId) => sessions.get(sessionId),
    set: (sessionId, transport) => {
      sessions.set(sessionId, transport);
    },
    delete: (sessionId) => {
      sessions.delete(sessionId);
    },
    list: () => Array.from(sessions.values()),
  };
}
