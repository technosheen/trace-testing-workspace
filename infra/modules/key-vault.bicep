param location string
param tags object
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: 'trace9636vault'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}
output name string = vault.name
output uri string = vault.properties.vaultUri
