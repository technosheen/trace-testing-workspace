// Deploy separately after the initial vault and its scoped RBAC are ready.
param vaultName string = 'trace9636vault'
@secure()
param runnerKey string
@secure()
param passwordHash string
@secure()
param sessionSecret string
@secure()
param workspacePassword string
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = { name: vaultName }
resource runner 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'runner-key'
  properties: { value: runnerKey }
}
resource password 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'password-hash'
  properties: { value: passwordHash }
}
resource session 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'session-secret'
  properties: { value: sessionSecret }
}
resource workspace 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'workspace-password'
  properties: { value: workspacePassword }
}
