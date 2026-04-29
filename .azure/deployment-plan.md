# Deployment plan: Azure Functions

## Goal

Run `backlog-mcp-server` on Azure Functions while keeping the existing stdio and standalone Node HTTP transports intact.

## Deliverables

- Shared HTTP MCP handler reused by Node and Azure Functions
- Azure Functions v4 HTTP triggers for `/health` and `/mcp`
- Azure Functions config files: `host.json`, `local.settings.json.example`, `.funcignore`
- Infrastructure as code in `infra/main.bicep`
- Documentation in `docs/azure-functions.md` and `README.md`

## Deployment flow

1. Provision infrastructure with `infra/main.bicep`
2. Inject Backlog secrets with App Settings or Key Vault references
3. Build the TypeScript project
4. Publish with `func azure functionapp publish <app-name> --javascript`
5. Validate `/health`
6. Validate `/mcp` initialize and at least one follow-up MCP call using the returned `mcp-session-id`

## Validation checklist

- `npm run lint`
- `npm run build`
- `npm test`
- Local `func start` responds on `/health` and `/mcp`
- Azure deployment responds on `/health`
- Azure deployment accepts `initialize`
- Azure deployment routes a subsequent MCP request with `mcp-session-id`

## Known limitation

MCP HTTP sessions are still stored in memory. Scaling out or cold starts can invalidate active sessions until a shared store is introduced in a future change.
