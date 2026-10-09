param location string
param tags object
resource account 'Microsoft.Storage/storageAccounts@2026-09-01' = {
  name: 'trace9636storage'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    accessTier: 'Hot'
  }
}
resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2026-09-01' = {
  name: '${account.name}/default/trace-data'
  properties: {
    shareQuota: 10
    enabledProtocols: 'SMB'
    accessTier: 'TransactionOptimized'
  }
}
output name string = account.name
