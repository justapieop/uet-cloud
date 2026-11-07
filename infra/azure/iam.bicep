targetScope = 'subscription'

@description('Existing platform resource group. This deployment manages IAM only.')
param platformResourceGroup string
param apiPrincipalId string
param pullPrincipalId string
param registryName string
param configurationStoreName string
param keyVaultName string
param pullIdentityName string
param sharedEnvironmentName string

@description('Use a separate namespace for a new environment; the default preserves existing role IDs.')
param roleNamespace string = 'kumo'

@description('Preserve existing assignment GUIDs when adopting portal/CLI-created grants.')
param existingAssignmentNames object = {}

var runtimeRoleId = roleNamespace == 'kumo' ? guid(subscription().id, 'kumo-runtime-operations-v1') : guid(subscription().id, roleNamespace, 'kumo-runtime-operations-v1')
var environmentRoleId = roleNamespace == 'kumo' ? guid(subscription().id, 'kumo-environment-access-v1') : guid(subscription().id, roleNamespace, 'kumo-environment-access-v1')
var roleSuffix = roleNamespace == 'kumo' ? uniqueString(subscription().id) : uniqueString(subscription().id, roleNamespace)

// Subscription scope is needed by the current dynamic user-RG provisioner.
// RBAC cannot restrict these actions to resource groups by a name prefix.
// Application ownership guards remain essential; this is not tenant isolation.
resource runtimeRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: runtimeRoleId
  properties: {
    roleName: 'Kumo Runtime Operations ${roleSuffix}'
    description: 'Shared-mode runtime operations; no IAM writes, policy writes, network writes, SQL administration, registry administration, or environment provisioning.'
    type: 'CustomRole'
    assignableScopes: [subscription().id]
    permissions: [{
      actions: [
        'Microsoft.Resources/subscriptions/read'
        'Microsoft.Resources/subscriptions/locations/read'
        'Microsoft.Resources/subscriptions/providers/read'
        'Microsoft.Resources/subscriptions/resourceGroups/read'
        'Microsoft.Resources/subscriptions/resourceGroups/write'
        'Microsoft.Authorization/policyAssignments/read'
        'Microsoft.App/containerApps/read'
        'Microsoft.App/containerApps/revisions/read'
        'Microsoft.App/containerApps/write'
        'Microsoft.App/containerApps/delete'
        'Microsoft.App/containerApps/start/action'
        'Microsoft.App/containerApps/stop/action'
        'Microsoft.App/locations/containerappoperationstatuses/read'
        'Microsoft.App/locations/containerappoperationresults/read'
        'Microsoft.App/managedEnvironments/read'
        'Microsoft.Storage/storageAccounts/read'
        'Microsoft.Storage/storageAccounts/write'
        'Microsoft.Storage/storageAccounts/fileServices/read'
        'Microsoft.Storage/storageAccounts/fileServices/shares/read'
        'Microsoft.Storage/storageAccounts/fileServices/shares/write'
        'Microsoft.Storage/storageAccounts/fileServices/shares/delete'
        'Microsoft.Insights/metrics/read'
      ]
      notActions: []
      dataActions: []
      notDataActions: []
    }]
  }
}

// Environment configuration and networking stay operator-owned. Storage-link
// CRUD is required by the existing volume adapter and deletion cleanup.
resource environmentRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: environmentRoleId
  properties: {
    roleName: 'Kumo Shared Environment Access ${roleSuffix}'
    description: 'Join/read an existing environment and manage its Azure Files links; cannot change the environment or network.'
    type: 'CustomRole'
    assignableScopes: [subscription().id]
    permissions: [{
      actions: [
        'Microsoft.App/managedEnvironments/read'
        'Microsoft.App/managedEnvironments/join/action'
        'Microsoft.App/managedEnvironments/storages/read'
        'Microsoft.App/managedEnvironments/storages/write'
        'Microsoft.App/managedEnvironments/storages/delete'
      ]
      notActions: []
      dataActions: []
      notDataActions: []
    }]
  }
}

resource runtimeAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: existingAssignmentNames.?runtime ?? guid(subscription().id, apiPrincipalId, runtimeRole.id)
  properties: {
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: runtimeRole.id
  }
}

module platform './modules/iam-platform.bicep' = {
  name: 'kumo-platform-iam'
  scope: resourceGroup(platformResourceGroup)
  params: {
    apiPrincipalId: apiPrincipalId
    pullPrincipalId: pullPrincipalId
    registryName: registryName
    configurationStoreName: configurationStoreName
    keyVaultName: keyVaultName
    pullIdentityName: pullIdentityName
    sharedEnvironmentName: sharedEnvironmentName
    environmentRoleDefinitionId: environmentRole.id
    existingAssignmentNames: existingAssignmentNames
  }
}

output desiredAssignments array = concat([{
  principalId: apiPrincipalId
  roleDefinitionId: runtimeRole.id
  scope: subscription().id
}], platform.outputs.desiredAssignments)

