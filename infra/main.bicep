// GIT Capital Projects Platform — Azure resources (architecture section 1.1).
// Deploy into resource group rg-git-capital-projects:
//   az deployment group create -g rg-git-capital-projects -f infra/main.bicep -p infra/main.parameters.json
// Secrets are never in this file: Key Vault holds them, the app reads them with its managed identity.

@description('Short environment name: prod, test or dev')
param envName string = 'prod'
param location string = resourceGroup().location
@description('Container image, e.g. gitcppacr.azurecr.io/git-capital-projects:abc123. Leave the default for the first deployment.')
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'
@description('Entra tenant and the app registration "GIT Capital Projects Platform"')
param tenantId string = '6cbf8d55-4474-4ef5-85d7-d5144d970539'
param entraClientId string = '0fc09c94-b943-468b-8642-4616315e435c'
@description('SharePoint drive and folder item ids of "GIT Project Management Claude Platform"')
param spDriveId string = 'b!A1NLSZe1ZkK5QwrXZDNALHh5J1PgPGZLvpJgaDvCnZPgZHUClmbgSq5SL2o30ovp'
param spRootItemId string = '016VWGM5LMN6VZCHNETJGKSYDS47UAALQH'
@description('Object id of the person who manages secrets (Joe)')
param adminObjectId string
@secure()
@description('PostgreSQL admin password. First deployment: leave empty and one is generated. Later deployments: the pipeline passes the value already in Key Vault (db-admin-password), so it never changes by accident.')
param dbPassword string = ''
@secure()
@description('Session signing secret. Same pattern: empty on first deployment, then the pipeline passes the Key Vault value (auth-secret).')
param authSecret string = ''
@secure()
@description('Do not set: seeds for first-deployment secrets (newGuid() is only allowed in parameter defaults).')
param seedA string = newGuid()
@secure()
param seedB string = newGuid()
var dbPass = empty(dbPassword) ? '${seedA}Aa1!' : dbPassword
var authSecretValue = empty(authSecret) ? '${seedA}${seedB}' : authSecret

var name = 'gitcpp-${envName}'
var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'git-capital-projects', env: envName, owner: 'joeg' }

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'gitcpp${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource appId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-id'
  location: location
  tags: tags
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'gitcpp-${take(suffix, 10)}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: true
  }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${name}-pg-${take(suffix, 6)}'
  location: location
  tags: tags
  sku: { name: 'Standard_B2ms', tier: 'Burstable' } // pilot size; move to GP_Standard_D2ds_v5 at go-live
  properties: {
    version: '16'
    administratorLogin: 'gitcppadmin'
    administratorLoginPassword: dbPass
    storage: { storageSizeGB: 64, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 35, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pg
  name: 'gitcpp'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'PGCRYPTO,CITEXT', source: 'user-override' }
}

// Only Azure services (the Container App) may connect. Tighten to the environment's static IP later.
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: pg
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource secretDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: { value: 'postgres://gitcppadmin:${uriComponent(dbPass)}@${pg.properties.fullyQualifiedDomainName}:5432/gitcpp' }
}

resource secretDbPass 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'db-admin-password'
  properties: { value: dbPass }
}

resource secretAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'auth-secret'
  properties: { value: authSecretValue }
}
// 'entra-client-secret' is added by Joe from the app registration (Certificates & secrets); see docs/SETUP.md.

var kvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var kvSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource raKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, appId.id, kvSecretsUser)
  scope: kv
  properties: { principalId: appId.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser) }
}
resource raKvAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, adminObjectId, kvSecretsOfficer)
  scope: kv
  properties: { principalId: adminObjectId, principalType: 'User', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficer) }
}
resource raAcr 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appId.id, acrPull)
  scope: acr
  properties: { principalId: appId.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull) }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } }
  }
}

var kvUri = kv.properties.vaultUri
var secrets = [
  { name: 'database-url', keyVaultUrl: '${kvUri}secrets/database-url', identity: appId.id }
  { name: 'auth-secret', keyVaultUrl: '${kvUri}secrets/auth-secret', identity: appId.id }
  { name: 'entra-client-secret', keyVaultUrl: '${kvUri}secrets/entra-client-secret', identity: appId.id }
]
var usesPlaceholder = startsWith(image, 'mcr.microsoft.com')
var commonEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'DATABASE_SSL', value: '1' }
  { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
  { name: 'AUTH_TRUST_HOST', value: 'true' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', secretRef: 'entra-client-secret' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_TENANT_ID', value: tenantId }
  { name: 'DOCSTORE', value: 'graph' }
  { name: 'GRAPH_TENANT_ID', value: tenantId }
  { name: 'GRAPH_CLIENT_ID', value: entraClientId }
  { name: 'GRAPH_CLIENT_SECRET', secretRef: 'entra-client-secret' }
  { name: 'SP_DRIVE_ID', value: spDriveId }
  { name: 'SP_ROOT_ITEM_ID', value: spRootItemId }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
]

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-web'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appId.id}': {} } }
  dependsOn: [raKv, raAcr]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: { external: true, targetPort: usesPlaceholder ? 80 : 3000, transport: 'auto', allowInsecure: false }
      registries: usesPlaceholder ? [] : [{ server: acr.properties.loginServer, identity: appId.id }]
      secrets: usesPlaceholder ? [] : secrets
    }
    template: {
      containers: [{
        name: 'web'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: usesPlaceholder ? [] : concat(commonEnv, [{ name: 'APP_BASE_URL', value: 'https://${name}-web.${cae.properties.defaultDomain}' }])
        probes: usesPlaceholder ? [] : [
          { type: 'Liveness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 10 }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 4 }
    }
  }
}

resource migrate 'Microsoft.App/jobs@2024-03-01' = if (!usesPlaceholder) {
  name: '${name}-migrate'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appId.id}': {} } }
  dependsOn: [raKv, raAcr]
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: acr.properties.loginServer, identity: appId.id }]
      secrets: [secrets[0]]
    }
    template: {
      containers: [{
        name: 'migrate'
        image: image
        command: ['node', 'scripts/migrate.mjs']
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [{ name: 'DATABASE_URL', secretRef: 'database-url' }, { name: 'DATABASE_SSL', value: '1' }]
      }]
    }
  }
}

output appUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output signInRedirectUri string = 'https://${web.properties.configuration.ingress.fqdn}/api/auth/callback/microsoft-entra-id'
output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output keyVaultName string = kv.name
output webAppName string = web.name
output migrateJobName string = '${name}-migrate'
