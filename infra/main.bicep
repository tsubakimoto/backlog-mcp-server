@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Function App name. This must be globally unique.')
@minLength(3)
param appName string

@description('Linux Functions runtime version.')
@allowed([
  '22'
  '20'
])
param nodeMajorVersion string = '22'

@description('Optional Backlog domain injected as an app setting.')
param backlogDomain string = ''

@secure()
@description('Optional BACKLOG_API_KEY app setting value. Pass a secret value or a Key Vault reference string.')
param backlogApiKeySettingValue string = ''

@description('Comma-separated toolsets to enable.')
param enableToolsets string = 'all'

@description('Set to true to enable dynamic toolsets.')
param enableDynamicToolsets string = 'false'

@description('Set to true to enable GraphQL-style field optimization.')
param optimizeResponse string = 'false'

@description('Maximum number of tokens allowed in responses.')
param maxTokens string = '50000'

@description('Optional string prefix prepended to generated outputs.')
param prefix string = ''

@description('Optional comma-separated host allow-list for the MCP endpoint.')
param mcpHttpAllowedHosts string = ''

var uniqueSuffix = uniqueString(resourceGroup().id, appName)
var storageAccountName = toLower(take(replace('st${appName}${uniqueSuffix}', '-', ''), 24))
var functionPlanName = '${appName}-plan'
var workspaceName = '${appName}-logs'
var applicationInsightsName = '${appName}-appi'
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: functionPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|${nodeMajorVersion}'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsights.properties.ConnectionString
        }
        {
          name: 'MCP_HTTP_JSON_RESPONSE'
          value: 'true'
        }
        {
          name: 'ENABLE_TOOLSETS'
          value: enableToolsets
        }
        {
          name: 'ENABLE_DYNAMIC_TOOLSETS'
          value: enableDynamicToolsets
        }
        {
          name: 'OPTIMIZE_RESPONSE'
          value: optimizeResponse
        }
        {
          name: 'MAX_TOKENS'
          value: maxTokens
        }
        {
          name: 'PREFIX'
          value: prefix
        }
        {
          name: 'BACKLOG_DOMAIN'
          value: backlogDomain
        }
        {
          name: 'BACKLOG_API_KEY'
          value: backlogApiKeySettingValue
        }
        {
          name: 'MCP_HTTP_ALLOWED_HOSTS'
          value: mcpHttpAllowedHosts
        }
      ]
    }
  }
}

output functionAppName string = functionApp.name
output defaultHostname string = functionApp.properties.defaultHostName
output healthUrl string = 'https://${functionApp.properties.defaultHostName}/health'
output mcpUrl string = 'https://${functionApp.properties.defaultHostName}/mcp'
