targetScope = 'resourceGroup'
param location string
param names object
param tags object
@minLength(1)
param apiImage string
@minLength(1)
param webImage string
param runtimeIdentityId string
param runtimeClientId string
param platformPullIdentityId string
param managedEnvironmentId string
param configurationEndpoint string
param apiUrl string

resource api 'Microsoft.App/containerApps@2025-07-01' = {
  name: names.api
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${runtimeIdentityId}': {}, '${platformPullIdentityId}': {} }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: '${names.platformRegistry}.azurecr.io', identity: platformPullIdentityId }]
      identitySettings: [
        { identity: platformPullIdentityId, lifecycle: 'None' }
        { identity: runtimeIdentityId, lifecycle: 'Main' }
      ]
    }
    template: {
      containers: [{
        name: 'api'
        image: apiImage
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'CONFIG_SOURCE', value: 'azure' }
          { name: 'PORT', value: '3000' }
          { name: 'AZURE_CLIENT_ID', value: runtimeClientId }
          { name: 'AZURE_APPCONFIG_ENDPOINT', value: configurationEndpoint }
        ]
        probes: [
          { type: 'Startup', tcpSocket: { port: 3000 }, periodSeconds: 5, failureThreshold: 60 }
          { type: 'Readiness', httpGet: { path: '/', port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}
resource web 'Microsoft.App/containerApps@2025-07-01' = {
  name: names.web
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${platformPullIdentityId}': {} } }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: '${names.platformRegistry}.azurecr.io', identity: platformPullIdentityId }]
      identitySettings: [{ identity: platformPullIdentityId, lifecycle: 'None' }]
    }
    template: {
      containers: [{
        name: 'web'
        image: webImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'PORT', value: '3000' }
          { name: 'HOSTNAME', value: '0.0.0.0' }
          { name: 'API_URL', value: apiUrl }
        ]
        probes: [
          { type: 'Startup', tcpSocket: { port: 3000 }, periodSeconds: 5, failureThreshold: 30 }
          { type: 'Readiness', tcpSocket: { port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}
