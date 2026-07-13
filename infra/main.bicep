// Azure Infrastructure for Buff Olympics (resources use buffolympics prefix)
// Deploy: az deployment group create --resource-group <rg> --template-file infra/main.bicep --parameters @infra/main.parameters.json

@description('Base name used as a prefix for all resources')
param appName string = 'buffolympics'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Environment tag (e.g. prod, staging)')
param environment string = 'prod'

@description('Microsoft Fabric SQL Database server hostname (…database.fabric.microsoft.com)')
param fabricSqlServer string

@description('Microsoft Fabric SQL Database name')
param fabricSqlDatabase string

@description('Entra tenant ID for the service principal used by mssql')
param aadTenantId string

@description('Service principal (app registration) client ID with access to the Fabric SQL DB')
param aadClientId string

@secure()
@description('Service principal client secret (the Secret VALUE, not the Secret ID GUID)')
param aadClientSecret string

@secure()
@description('Long random string used to sign session tokens (HMAC-SHA256)')
param sessionSecret string

@description('Comma-separated emails that get admin on sign-in (e.g. cory@…)')
param adminEmails string = ''

// ---------------------------------------------------------------------------
// Azure Static Web App (hosting + managed Azure Functions)
// ---------------------------------------------------------------------------
resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: '${appName}-swa'
  location: location
  tags: { environment: environment, app: appName }
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    buildProperties: {
      appLocation: '/'
      apiLocation: 'api'
      outputLocation: ''
    }
  }
}

resource swaSettings 'Microsoft.Web/staticSites/config@2022-09-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    FABRIC_SQL_SERVER:   fabricSqlServer
    FABRIC_SQL_DATABASE: fabricSqlDatabase
    AZURE_TENANT_ID:     aadTenantId
    AZURE_CLIENT_ID:     aadClientId
    AZURE_CLIENT_SECRET: aadClientSecret
    SESSION_SECRET:      sessionSecret
    ADMIN_EMAILS:        adminEmails
    NODE_ENV:            'production'
  }
}

output staticWebAppHostname string = staticWebApp.properties.defaultHostname
