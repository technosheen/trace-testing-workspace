targetScope = 'resourceGroup'
param accountName string = 'seantmahoney92-3750-resource'
param principalId string
param deployerObjectId string
resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = { name: accountName }
resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: 'trace-drafting'
  sku: { name: 'GlobalStandard', capacity: 10 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4.1-mini', version: '2025-04-14' }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}
var userRole = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
resource appAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, principalId, userRole)
  scope: account
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', userRole)
  }
}
resource deployerAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, deployerObjectId, userRole)
  scope: account
  properties: {
    principalId: deployerObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', userRole)
  }
}
