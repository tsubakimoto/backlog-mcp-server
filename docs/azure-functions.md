# Azure Functions

This repository can run the existing MCP HTTP transport on Azure Functions v4 without changing the stdio CLI entrypoint.

## What is included

- Shared MCP HTTP fetch handler reused by both Node HTTP and Azure Functions
- Azure Functions v4 HTTP triggers for `/health` and `/mcp`
- `host.json` with an empty route prefix so the endpoints stay `/health` and `/mcp`
- `local.settings.json.example` for local development
- `infra/main.bicep` for a Linux Consumption Function App, Storage Account, Application Insights, and Log Analytics workspace

## Requirements

- Node.js 20 or later
- Azure Functions Core Tools v4
- Azurite or an Azure Storage connection string for local execution
- Azure CLI for infrastructure deployment

## Local execution

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. Copy the local settings example:

   ```bash
   cp local.settings.json.example local.settings.json
   ```

3. Set at least these values in `local.settings.json`:

- `BACKLOG_DOMAIN`
- `BACKLOG_API_KEY`
- `AzureWebJobsStorage`

4. Start Azurite if you use `UseDevelopmentStorage=true`.

5. Start the Functions host:

   ```bash
   npm run start:functions
   ```

6. Verify the endpoints:

   ```bash
   curl http://localhost:7071/health
   ```

   ```bash
   curl http://localhost:7071/mcp \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"local-test","version":"1.0.0"}}}'
   ```

## Azure deployment

This repository assumes Azure Functions Core Tools publish as the default deployment path.

1. Create a resource group if needed:

   ```bash
   RESOURCE_GROUP=<resource-group>
   REGION=<region>
   az group create --name $RESOURCE_GROUP --location $REGION
   ```

2. Deploy infrastructure:

   ```bash
   FUNCTION_APP_NAME=<function-app-name>
   az deployment group create \
     --resource-group $RESOURCE_GROUP \
     --template-file infra/main.bicep \
     --parameters @infra/main.parameters.example.json \
     --parameters appName=$FUNCTION_APP_NAME \
     --parameters backlogDomain=<your-domain.backlog.com>
   ```

3. Set the Backlog API key as an app setting.

   Plain app setting:

   ```bash
   az functionapp config appsettings set \
     --name $FUNCTION_APP_NAME \
     --resource-group <resource-group> \
     --settings BACKLOG_API_KEY=<your-api-key>
   ```

   Or set a Key Vault reference string in the same `BACKLOG_API_KEY` setting after granting the Function App managed identity access to the secret.

4. Publish the application:

   ```bash
   npm run build
   func azure functionapp publish $FUNCTION_APP_NAME --javascript
   ```

5. Get a function key and call the MCP endpoint:

   ```bash
   FUNCTION_KEY=$(az functionapp function keys list \
     --resource-group $RESOURCE_GROUP \
     --name $FUNCTION_APP_NAME \
     --function-name mcp \
     --query default -o tsv)
   ```

   ```bash
   curl "https://$FUNCTION_APP_NAME.azurewebsites.net/mcp?code=${FUNCTION_KEY}" \
     -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"azure-test","version":"1.0.0"}}}'
   ```

## App settings

Required:

- `BACKLOG_DOMAIN` or multi-org `BACKLOG_ORG_<NAME>_DOMAIN`
- `BACKLOG_API_KEY` or multi-org `BACKLOG_ORG_<NAME>_API_KEY`
- `FUNCTIONS_WORKER_RUNTIME=node`
- `AzureWebJobsStorage`

Recommended defaults on Azure:

- `MCP_HTTP_JSON_RESPONSE=true`
- `ENABLE_TOOLSETS=all`
- `ENABLE_DYNAMIC_TOOLSETS=false`
- `OPTIMIZE_RESPONSE=false`
- `MAX_TOKENS=50000`

Optional:

- `BACKLOG_DEFAULT_ORG`
- `PREFIX`
- `MCP_HTTP_ALLOWED_HOSTS` (`WEBSITE_HOSTNAME` is used as the default allowlist when unset)

## Operational note

`/mcp` uses Azure Functions `function` auth by default, so clients typically call it with `?code=<function-key>` unless another auth layer is added in front.

HTTP MCP sessions remain in memory. This initial Azure Functions support is intended for single-instance or sticky usage. Cold starts and scale-out can invalidate `mcp-session-id` values because the registry is instance-local.

Current non-goals / TODO:

- No shared session store between instances
- No TTL / eviction policy for the in-memory session registry yet
