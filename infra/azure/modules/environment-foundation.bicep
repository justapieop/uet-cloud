targetScope = 'resourceGroup'
param location string
param names object
param tags object
param sqlAdministratorObjectId string
param sqlAdministratorLogin string
param sqlAdministratorType string
param bootstrapPrincipalId string
param bootstrapPrincipalType string
@secure()
param mongoAdminPassword string
param mongoAdminUsername string
param mongoComputeTier string
param redisSku string
param configurationSku string
param sqlUseFreeLimit bool
param usePrivateSqlAndMongo bool
param administratorIpAddresses array
param enableLogAnalytics bool
param integrationSettings object
param integrationVaultReferences object
param githubSigningKeyName string

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${names.environment}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'aca'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'private-endpoints'
        properties: { addressPrefix: '10.40.2.0/24', privateEndpointNetworkPolicies: 'Disabled' }
      }
    ]
  }
}
var endpointSubnetId = '${network.id}/subnets/private-endpoints'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (enableLogAnalytics) {
  name: '${names.environment}-logs'
  location: location
  tags: tags
  properties: { retentionInDays: 30, sku: { name: 'PerGB2018' } }
}
resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: names.environment
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    vnetConfiguration: { infrastructureSubnetId: '${network.id}/subnets/aca', internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: enableLogAnalytics ? {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs!.properties.customerId, sharedKey: logs!.listKeys().primarySharedKey }
    } : null
    zoneRedundant: false
  }
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.runtimeIdentity
  location: location
  tags: tags
}
resource tenantPull 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.tenantPullIdentity
  location: location
  tags: tags
}
resource platformPull 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.platformPullIdentity
  location: location
  tags: tags
}
resource platformRegistry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: names.platformRegistry
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false, anonymousPullEnabled: false, roleAssignmentMode: 'AbacRepositoryPermissions' }
}
resource tenantRegistry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: names.tenantRegistry
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false, anonymousPullEnabled: false, roleAssignmentMode: 'AbacRepositoryPermissions' }
}
var repositoryReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')
resource platformImagePull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(platformRegistry.id, platformPull.id, repositoryReader)
  scope: platformRegistry
  properties: { principalId: platformPull.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: repositoryReader }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.vault
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}
resource configuration 'Microsoft.AppConfiguration/configurationStores@2024-05-01' = {
  name: names.configuration
  location: location
  tags: tags
  sku: { name: configurationSku }
  properties: { disableLocalAuth: false, publicNetworkAccess: 'Enabled' }
}

var operatorGrants = [
  { key: 'secrets', role: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' }
  { key: 'keys', role: '14b46e9e-c2b7-41b4-b07b-48a6ebf60603' }
]
resource vaultOperator 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for grant in operatorGrants: {
  name: guid(vault.id, bootstrapPrincipalId, grant.role)
  scope: vault
  properties: {
    principalId: bootstrapPrincipalId
    principalType: bootstrapPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', grant.role)
  }
}]
resource configurationOperator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(configuration.id, bootstrapPrincipalId, 'appconfig-data-owner')
  scope: configuration
  properties: {
    principalId: bootstrapPrincipalId
    principalType: bootstrapPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5ae67dd6-50cb-40e7-96ff-dc2bfa4b606b')
  }
}
var publishingRoles = [
  '2a1e307c-b015-4ebd-883e-5b7698a07328'
  'bfdb9389-c9a5-478a-bb2f-ba9ca092c3c7'
]
resource platformPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in publishingRoles: {
  name: guid(platformRegistry.id, bootstrapPrincipalId, role)
  scope: platformRegistry
  properties: {
    principalId: bootstrapPrincipalId
    principalType: bootstrapPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
  }
}]

resource sql 'Microsoft.Sql/servers@2023-08-01' = {
  name: names.sql
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: usePrivateSqlAndMongo ? 'Disabled' : 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: sqlAdministratorType
      login: sqlAdministratorLogin
      sid: sqlAdministratorObjectId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
  }
}
resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sql
  name: 'kumo'
  location: location
  tags: tags
  sku: { name: 'GP_S_Gen5', tier: 'GeneralPurpose', family: 'Gen5', capacity: 2 }
  properties: {
    minCapacity: json('0.5')
    autoPauseDelay: 60
    maxSizeBytes: 34359738368
    requestedBackupStorageRedundancy: 'Local'
    useFreeLimit: sqlUseFreeLimit
    ...(sqlUseFreeLimit ? { freeLimitExhaustionBehavior: 'AutoPause' } : {})
  }
}
resource sqlAzureFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01' = if (!usePrivateSqlAndMongo) {
  parent: sql
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
resource sqlAdministratorFirewall 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for (address, index) in administratorIpAddresses: if (!usePrivateSqlAndMongo) {
  parent: sql
  name: 'administrator-${index}'
  properties: { startIpAddress: address, endIpAddress: address }
}]
resource redis 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: names.redis
  location: location
  tags: tags
  sku: { name: redisSku }
  properties: { minimumTlsVersion: '1.2', highAvailability: 'Disabled', publicNetworkAccess: 'Disabled' }
}
resource redisDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  parent: redis
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    port: 10000
    clusteringPolicy: 'EnterpriseCluster'
    evictionPolicy: 'AllKeysLRU'
    accessKeysAuthentication: 'Enabled'
  }
}
resource mongo 'Microsoft.DocumentDB/mongoClusters@2025-09-01' = {
  name: names.mongo
  location: location
  tags: tags
  properties: {
    administrator: {
      userName: mongoAdminUsername
      password: mongoAdminPassword
    }
    authConfig: { allowedModes: ['NativeAuth'] }
    compute: { tier: mongoComputeTier }
    storage: { sizeGb: 32 }
    sharding: { shardCount: 1 }
    highAvailability: { targetMode: 'Disabled' }
    serverVersion: '8.0'
    publicNetworkAccess: usePrivateSqlAndMongo ? 'Disabled' : 'Enabled'
  }
}
resource mongoAzureFirewall 'Microsoft.DocumentDB/mongoClusters/firewallRules@2025-09-01' = if (!usePrivateSqlAndMongo) {
  parent: mongo
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
resource mongoAdministratorFirewall 'Microsoft.DocumentDB/mongoClusters/firewallRules@2025-09-01' = [for (address, index) in administratorIpAddresses: if (!usePrivateSqlAndMongo) {
  parent: mongo
  name: 'administrator-${index}'
  properties: { startIpAddress: address, endIpAddress: address }
}]

module sqlPrivate './private-service.bicep' = if (usePrivateSqlAndMongo) {
  name: 'sql-private'
  params: {
    name: names.sql
    location: location
    tags: tags
    serviceId: sql.id
    groupId: 'sqlServer'
    dnsZoneName: 'privatelink${az.environment().suffixes.sqlServerHostname}'
    subnetId: endpointSubnetId
    virtualNetworkId: network.id
  }
}
module redisPrivate './private-service.bicep' = {
  name: 'redis-private'
  params: {
    name: names.redis
    location: location
    tags: tags
    serviceId: redis.id
    groupId: 'redisEnterprise'
    dnsZoneName: 'privatelink.redis.azure.net'
    subnetId: endpointSubnetId
    virtualNetworkId: network.id
  }
}
module mongoPrivate './private-service.bicep' = if (usePrivateSqlAndMongo) {
  name: 'mongo-private'
  params: {
    name: names.mongo
    location: location
    tags: tags
    serviceId: mongo.id
    groupId: 'MongoCluster'
    dnsZoneName: 'privatelink.mongocluster.cosmos.azure.com'
    subnetId: endpointSubnetId
    virtualNetworkId: network.id
  }
}

// Fetch the service-issued endpoint, not an assumed hostname. ARM returns
// connection-string templates; credentials are URL-encoded and stored only in KV.
var mongoHost = split(split(last(split(mongo.listConnectionStrings().connectionStrings[0].connectionString, '@')), '/')[0], '?')[0]
resource mongoSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'mongodb-connection-string'
  properties: { value: 'mongodb+srv://${uriComponent(mongo.properties.administrator.userName!)}:${uriComponent(mongoAdminPassword)}@${mongoHost}/kumo-session?tls=true&authSource=admin&retryWrites=false&maxIdleTimeMS=120000' }
  dependsOn: [vaultOperator]
}
resource redisSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'redis-connection-url'
  properties: { value: 'rediss://:${uriComponent(redisDatabase.listKeys().primaryKey)}@${redis.properties.hostName}:10000' }
  dependsOn: [vaultOperator]
}
var apiUrl = 'https://${names.api}.${environment.properties.defaultDomain}'
var frontendUrl = 'https://${names.web}.${environment.properties.defaultDomain}'
var builtInSettings = {
  DATABASE_URL: sql.properties.fullyQualifiedDomainName
  DATABASE_PORT: '1433'
  DATABASE_NAME: database.name
  DATABASE_ENABLE_ENCRYPTION: 'true'
  AZURE_SUBSCRIPTION_ID: subscription().subscriptionId
  AZURE_PLATFORM_RESOURCE_GROUP: resourceGroup().name
  AZURE_RG_NAME: resourceGroup().name
  AZURE_SHARED_ENVIRONMENT_NAME: environment.name
  AZURE_CONTAINER_REGISTRY_NAME: tenantRegistry.name
  AZURE_CONTAINER_REGISTRY_SERVER: tenantRegistry.properties.loginServer
  AZURE_CONTAINER_REGISTRY_PULL_IDENTITY_NAME: tenantPull.name
  AZURE_VAULT_NAME: vault.name
  GITHUB_APP_PRIVATE_KEY_NAME: githubSigningKeyName
  FRONTEND_URL: frontendUrl
  GITHUB_OAUTH2_REDIRECT_URL: '${frontendUrl}/api/auth/callback'
  TRUST_PROXY_HOPS: '1'
}
// Infrastructure-generated settings take precedence over caller integrations.
var settings = union(integrationSettings, builtInSettings)
var secretReferences = union(integrationVaultReferences, {
  MONGODB_CONNECTION_STRING: mongoSecret.name
  REDIS_CONNECTION_URL: redisSecret.name
})
module configurationValues './environment-configuration.bicep' = {
  name: 'configuration-values'
  params: {
    configurationStoreName: configuration.name
    vaultUri: vault.properties.vaultUri
    settings: settings
    vaultReferences: secretReferences
  }
  dependsOn: [configurationOperator]
}

output runtimeIdentityId string = runtimeIdentity.id
output runtimePrincipalId string = runtimeIdentity.properties.principalId
output runtimeClientId string = runtimeIdentity.properties.clientId
output tenantPullPrincipalId string = tenantPull.properties.principalId
output platformPullIdentityId string = platformPull.id
output managedEnvironmentId string = environment.id
output configurationEndpoint string = configuration.properties.endpoint
output keyVaultUri string = vault.properties.vaultUri
output sqlServerFqdn string = sql.properties.fullyQualifiedDomainName
output apiUrl string = apiUrl
output frontendUrl string = frontendUrl


