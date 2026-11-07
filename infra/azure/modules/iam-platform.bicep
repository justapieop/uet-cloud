targetScope = 'resourceGroup'

param apiPrincipalId string
param pullPrincipalId string
param registryName string
param configurationStoreName string
param keyVaultName string
param pullIdentityName string
param sharedEnvironmentName string
param environmentRoleDefinitionId string
param existingAssignmentNames object

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource configuration 'Microsoft.AppConfiguration/configurationStores@2024-05-01' existing = { name: configurationStoreName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: pullIdentityName }
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: sharedEnvironmentName }

var reader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
var repositoryReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')
var configurationReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '516239f1-63e1-4d78-a4de-a74fb236a071')
var secretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var cryptoUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')
var identityOperator = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f1a07417-d97a-45cb-824c-7a7467783830')

resource registryMetadata 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?registryMetadata ?? guid(registry.id, apiPrincipalId, reader)
  scope: registry
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: reader }
}
resource imagePull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?imagePull ?? guid(registry.id, pullPrincipalId, repositoryReader)
  scope: registry
  properties: { principalId: pullPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: repositoryReader }
}
resource configRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?configRead ?? guid(configuration.id, apiPrincipalId, configurationReader)
  scope: configuration
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: configurationReader }
}
resource secretRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?secretRead ?? guid(vault.id, apiPrincipalId, secretsUser)
  scope: vault
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: secretsUser }
}
resource signing 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?signing ?? guid(vault.id, apiPrincipalId, cryptoUser)
  scope: vault
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: cryptoUser }
}
resource attachPullIdentity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?attachPullIdentity ?? guid(pullIdentity.id, apiPrincipalId, identityOperator)
  scope: pullIdentity
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: identityOperator }
}
resource sharedEnvironment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?sharedEnvironment ?? guid(environment.id, apiPrincipalId, environmentRoleDefinitionId)
  scope: environment
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: environmentRoleDefinitionId }
}

output desiredAssignments array = [
  { principalId: apiPrincipalId, roleDefinitionId: reader, scope: registry.id }
  { principalId: pullPrincipalId, roleDefinitionId: repositoryReader, scope: registry.id }
  { principalId: apiPrincipalId, roleDefinitionId: configurationReader, scope: configuration.id }
  { principalId: apiPrincipalId, roleDefinitionId: secretsUser, scope: vault.id }
  { principalId: apiPrincipalId, roleDefinitionId: cryptoUser, scope: vault.id }
  { principalId: apiPrincipalId, roleDefinitionId: identityOperator, scope: pullIdentity.id }
  { principalId: apiPrincipalId, roleDefinitionId: environmentRoleDefinitionId, scope: environment.id }
]

