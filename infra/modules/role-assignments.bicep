param principalId string
param deployerObjectId string
param vaultName string
param registryName string
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = { name: vaultName }
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: registryName }
var officerRole = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
var userRole = '4633458b-17de-408a-b874-0445c86b69e6'
var pullRole = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource officer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, deployerObjectId, officerRole)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', officerRole)
    principalId: deployerObjectId
    principalType: 'User'
  }
}
resource reader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, principalId, userRole)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', userRole)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, principalId, pullRole)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', pullRole)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
