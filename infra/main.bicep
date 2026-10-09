targetScope = 'subscription'
param environmentName string = 'trace'
param location string = 'eastus2'
param sessionId string
param deployedBy string
param createdAt string
param deployerObjectId string
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'trace-rg'
  location: location
  tags: tags
}
module identity './modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: { location: location, tags: tags }
}
module registry './modules/registry.bicep' = {
  name: 'registry'
  scope: rg
  params: { location: location, tags: tags }
}
module storage './modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: { location: location, tags: tags }
}
module vault './modules/key-vault.bicep' = {
  name: 'vault'
  scope: rg
  params: { location: location, tags: tags }
}
module roles './modules/role-assignments.bicep' = {
  name: 'roles'
  scope: rg
  params: {
    principalId: identity.outputs.principalId
    deployerObjectId: deployerObjectId
    vaultName: vault.outputs.name
    registryName: registry.outputs.name
  }
}
module environment './modules/environment.bicep' = {
  name: 'environment'
  scope: rg
  params: {
    location: location
    tags: tags
    storageName: storage.outputs.name
  }
}
module app './modules/container-app.bicep' = {
  name: 'app'
  scope: rg
  params: {
    location: location
    tags: tags
    containerImage: containerImage
    environmentId: environment.outputs.id
    environmentDomain: environment.outputs.domain
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    vaultUri: vault.outputs.uri
  }
  dependsOn: [roles]
}
output appUrl string = app.outputs.url
output vaultName string = vault.outputs.name
output registryServer string = registry.outputs.loginServer
output storageAccountName string = storage.outputs.name
output fileShareName string = 'trace-data'
