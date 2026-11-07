targetScope = 'resourceGroup'
param configurationStoreName string
param vaultUri string
param settings object
param vaultReferences object

resource store 'Microsoft.AppConfiguration/configurationStores@2024-05-01' existing = { name: configurationStoreName }
var plainEntries = filter(items(settings), item => !contains(vaultReferences, item.key))
resource plainValues 'Microsoft.AppConfiguration/configurationStores/keyValues@2024-05-01' = [for item in plainEntries: {
  parent: store
  name: item.key
  properties: { value: string(item.value) }
}]
resource referenceValues 'Microsoft.AppConfiguration/configurationStores/keyValues@2024-05-01' = [for item in items(vaultReferences): {
  parent: store
  name: item.key
  properties: {
    contentType: 'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8'
    value: string({ uri: '${vaultUri}secrets/${item.value}' })
  }
}]
