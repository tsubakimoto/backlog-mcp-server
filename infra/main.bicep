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

@description('Maximum number of Flex Consumption instances.')
@minValue(40)
@maxValue(1000)
param maximumInstanceCount int = 40

@description('Memory size in MB for each Flex Consumption instance.')
@allowed([
  512
  2048
  4096
])
param instanceMemoryMB int = 2048

@description('Optional Backlog domain injected as an app setting.')
param backlogDomain string = ''

@secure()
@description('Optional BACKLOG_API_KEY app setting value. Pass a secret value or a Key Vault reference string. Leave empty to preserve the current app setting on redeploy.')
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
var normalizedAppName = toLower(replace(replace(appName, '-', ''), '_', ''))
var storageAccountName = take('st${normalizedAppName}${uniqueSuffix}', 24)
var functionPlanName = '${appName}-plan'
var workspaceName = '${appName}-logs'
var applicationInsightsName = '${appName}-appi'
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
var deploymentContainerName = toLower(take('app-package-${replace(replace(appName, '.', '-'), '_', '-')}-${uniqueSuffix}', 63))
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var existingAppSettings = list('${functionApp.id}/config/appsettings', '2024-04-01').properties
var desiredAppSettings = {
  AzureWebJobsStorage: storageConnectionString
  FUNCTIONS_EXTENSION_VERSION: '~4'
  APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
  MCP_HTTP_JSON_RESPONSE: 'true'
  ENABLE_TOOLSETS: enableToolsets
  ENABLE_DYNAMIC_TOOLSETS: enableDynamicToolsets
  OPTIMIZE_RESPONSE: optimizeResponse
  MAX_TOKENS: maxTokens
  PREFIX: prefix
  BACKLOG_DOMAIN: backlogDomain
  MCP_HTTP_ALLOWED_HOSTS: mcpHttpAllowedHosts
}
var optionalSecretAppSettings = empty(backlogApiKeySettingValue) ? {} : {
  BACKLOG_API_KEY: backlogApiKeySettingValue
}

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
  resource blobServices 'blobServices' = {
    name: 'default'
    resource deploymentContainer 'containers' = {
      name: deploymentContainerName
      properties: {
        publicAccess: 'None'
      }
    }
  }
}

resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${appName}-deploy-id'
  location: location
}

resource deploymentStorageBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, deploymentIdentity.id, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource hostingPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: functionPlanName
  location: location
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${deploymentIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: deploymentIdentity.id
          }
        }
      }
      runtime: {
        name: 'node'
        version: nodeMajorVersion
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
    }
  }
}

resource functionAppSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  name: 'appsettings'
  parent: functionApp
  properties: union(existingAppSettings, desiredAppSettings, optionalSecretAppSettings)
}

output functionAppName string = functionApp.name
output defaultHostname string = functionApp.properties.defaultHostName
output healthUrl string = 'https://${functionApp.properties.defaultHostName}/health'
output mcpUrl string = 'https://${functionApp.properties.defaultHostName}/mcp'
