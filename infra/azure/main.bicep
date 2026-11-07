targetScope = 'subscription'

@minLength(2)
@maxLength(12)
@description('Lowercase letters/digits/hyphens, starting with a letter; use a different name per environment.')
param environmentName string
@description('Region supporting Container Apps, SQL, Azure Managed Redis, and DocumentDB.')
param location string
param sqlAdministratorObjectId string
param sqlAdministratorLogin string
@allowed(['User', 'Group', 'Application'])
param sqlAdministratorType string = 'User'
@description('Operator user/group/application allowed to upload secrets, import the GitHub key, and publish platform images.')
param bootstrapPrincipalId string = sqlAdministratorObjectId
@allowed(['User', 'Group', 'ServicePrincipal'])
param bootstrapPrincipalType string = sqlAdministratorType == 'Application' ? 'ServicePrincipal' : (sqlAdministratorType == 'Group' ? 'Group' : 'User')
@secure()
@minLength(16)
param mongoAdminPassword string
param mongoAdminUsername string = 'kumoadmin'
@description('Free has a one-cluster-per-subscription limit. A paid tier must be chosen explicitly if unavailable.')
param mongoComputeTier string = 'Free'
param redisSku string = 'Balanced_B0'
param configurationSku string = 'free'
@description('Pause SQL at its monthly free allowance instead of automatically charging for overages.')
param sqlUseFreeLimit bool = true
@description('Public SQL/Mongo use Azure-services firewall rules plus administratorIpAddresses. Redis remains private.')
param usePrivateSqlAndMongo bool = false
@description('Individual public IPv4 addresses allowed to administer SQL and MongoDB; no allow-all Internet rule is created.')
param administratorIpAddresses array = []
@description('Leave off for lower-cost development; real-time log streaming remains available.')
param enableLogAnalytics bool = false
param tags object = { application: 'kumo', environment: environmentName }

@description('Keep false until SQL initialization, secrets, GitHub key import, and images are ready.')
param deployApplications bool = false
param apiImage string = ''
param webImage string = ''
@description('Nonsecret integration settings, e.g. GitHub client ID and existing Azure DevOps pipeline coordinates. No DevOps IAM is provisioned.')
param integrationSettings object = {}
@description('Configuration key -> Key Vault secret name. Upload external secret values separately.')
param integrationVaultReferences object = {
  SESSION_SECRET: 'session-secret'
  STRIPE_SECRET_KEY: 'stripe-secret-key'
  GITHUB_OAUTH2_SECRET: 'github-oauth-secret'
  GITHUB_WEBHOOK_SECRET: 'github-webhook-secret'
}
param githubSigningKeyName string = 'github-app-signing'

var suffix = uniqueString(subscription().id, environmentName)
var names = {
  resourceGroup: '${environmentName}-${suffix}-rg'
  api: '${environmentName}-api'
  web: '${environmentName}-web'
  environment: '${environmentName}-${suffix}-aca'
  runtimeIdentity: '${environmentName}-runtime'
  tenantPullIdentity: '${environmentName}-tenant-pull'
  platformPullIdentity: '${environmentName}-platform-pull'
  platformRegistry: 'kumo${suffix}platform'
  tenantRegistry: 'kumo${suffix}tenant'
  vault: 'kv-${environmentName}-${take(suffix, 6)}'
  configuration: '${environmentName}-${suffix}-config'
  sql: '${environmentName}-${suffix}-sql'
  mongo: '${environmentName}-${suffix}-mongo'
  redis: '${environmentName}-${suffix}-redis'
}

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: names.resourceGroup
  location: location
  tags: tags
}

module foundation './modules/environment-foundation.bicep' = {
  name: '${environmentName}-foundation'
  scope: group
  params: {
    location: location
    names: names
    tags: tags
    sqlAdministratorObjectId: sqlAdministratorObjectId
    sqlAdministratorLogin: sqlAdministratorLogin
    sqlAdministratorType: sqlAdministratorType
    bootstrapPrincipalId: bootstrapPrincipalId
    bootstrapPrincipalType: bootstrapPrincipalType
    mongoAdminPassword: mongoAdminPassword
    mongoAdminUsername: mongoAdminUsername
    mongoComputeTier: mongoComputeTier
    redisSku: redisSku
    configurationSku: configurationSku
    sqlUseFreeLimit: sqlUseFreeLimit
    usePrivateSqlAndMongo: usePrivateSqlAndMongo
    administratorIpAddresses: administratorIpAddresses
    enableLogAnalytics: enableLogAnalytics
    integrationSettings: integrationSettings
    integrationVaultReferences: integrationVaultReferences
    githubSigningKeyName: githubSigningKeyName
  }
}

module iam './iam.bicep' = {
  name: '${environmentName}-iam'
  params: {
    platformResourceGroup: group.name
    apiPrincipalId: foundation.outputs.runtimePrincipalId
    pullPrincipalId: foundation.outputs.tenantPullPrincipalId
    registryName: names.tenantRegistry
    configurationStoreName: names.configuration
    keyVaultName: names.vault
    pullIdentityName: names.tenantPullIdentity
    sharedEnvironmentName: names.environment
    roleNamespace: names.resourceGroup
  }
}

module applications './modules/environment-applications.bicep' = if (deployApplications) {
  name: '${environmentName}-applications'
  scope: group
  params: {
    location: location
    names: names
    tags: tags
    apiImage: apiImage
    webImage: webImage
    runtimeIdentityId: foundation.outputs.runtimeIdentityId
    runtimeClientId: foundation.outputs.runtimeClientId
    platformPullIdentityId: foundation.outputs.platformPullIdentityId
    managedEnvironmentId: foundation.outputs.managedEnvironmentId
    configurationEndpoint: foundation.outputs.configurationEndpoint
    apiUrl: foundation.outputs.apiUrl
  }
  dependsOn: [iam]
}

output resourceNames object = names
output runtimePrincipalId string = foundation.outputs.runtimePrincipalId
output runtimeClientId string = foundation.outputs.runtimeClientId
output sqlServerFqdn string = foundation.outputs.sqlServerFqdn
output sqlDatabaseName string = 'kumo'
output keyVaultUri string = foundation.outputs.keyVaultUri
output configurationEndpoint string = foundation.outputs.configurationEndpoint
output apiUrl string = foundation.outputs.apiUrl
output frontendUrl string = foundation.outputs.frontendUrl
output platformRegistryServer string = '${names.platformRegistry}.azurecr.io'
output tenantRegistryServer string = '${names.tenantRegistry}.azurecr.io'

