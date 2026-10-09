param location string
param tags object
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'trace-identity'
  location: location
  tags: tags
}
output id string = identity.id
output principalId string = identity.properties.principalId
