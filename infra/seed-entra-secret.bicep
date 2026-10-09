param vaultName string = 'trace9636vault'
@secure()
param clientSecret string
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = { name: vaultName }
resource credential 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'microsoft-provider-authentication-secret'
  properties: { value: clientSecret }
}
