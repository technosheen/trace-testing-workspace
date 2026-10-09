param location string
param tags object
param storageName string
resource account 'Microsoft.Storage/storageAccounts@2026-09-01' existing = { name: storageName }
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'trace-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: { destination: 'none' }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    zoneRedundant: false
  }
}
resource files 'Microsoft.App/managedEnvironments/storages@2026-07-01' = {
  parent: environment
  name: 'trace-data'
  properties: {
    azureFile: {
      accountName: account.name
      accountKey: account.listKeys().keys[0].value
      shareName: 'trace-data'
      accessMode: 'ReadWrite'
    }
  }
}
output id string = environment.id
output domain string = environment.properties.defaultDomain
