import type { HttpRequest, HttpResponseInit } from '@azure/functions';

export async function toFetchRequest(request: HttpRequest): Promise<Request> {
  const init: globalThis.RequestInit = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };

  if (request.body && !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.text();
  }

  return new Request(request.url, init);
}

export function toAzureHttpResponse(response: Response): HttpResponseInit {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: response.body ?? undefined,
  };
}
