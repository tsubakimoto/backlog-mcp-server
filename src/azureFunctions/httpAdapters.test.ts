import { HttpRequest } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import {
  toAzureHttpResponse,
  toFetchRequest,
} from './httpAdapters.js';

describe('Azure Functions HTTP adapters', () => {
  it('converts an Azure Functions request to a fetch Request', async () => {
    const request = new HttpRequest({
      method: 'POST',
      url: 'https://example.azurewebsites.net/mcp?code=test',
      headers: { 'content-type': 'application/json', 'x-test': 'value' },
      body: { string: JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }) },
    });

    const fetchRequest = await toFetchRequest(request);

    expect(fetchRequest.method).toBe('POST');
    expect(fetchRequest.url).toBe(
      'https://example.azurewebsites.net/mcp?code=test'
    );
    expect(fetchRequest.headers.get('x-test')).toBe('value');
    await expect(fetchRequest.json()).resolves.toMatchObject({
      method: 'initialize',
    });
  });

  it('converts a fetch Response to an Azure Functions response', async () => {
    const response = toAzureHttpResponse(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        },
      })
    );

    expect(response.status).toBe(202);
    expect(response.headers).toMatchObject({
      'content-type': 'application/json',
      'mcp-session-id': 'session-1',
    });
  });
});
