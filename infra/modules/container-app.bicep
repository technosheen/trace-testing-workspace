param location string
param tags object
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param environmentId string
param environmentDomain string
param identityId string
param registryServer string
param vaultUri string
param identityClientId string
param aiEndpoint string = ''
param aiDeployment string = ''
param entraClientId string = ''
param entraTenantId string = ''
param entraAllowedObjectId string = ''
var isPlaceholder = containerImage == 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var port = isPlaceholder ? 80 : 8080
var secretNames = empty(entraClientId) ? ['runner-key', 'password-hash', 'session-secret'] : ['runner-key', 'password-hash', 'session-secret', 'microsoft-provider-authentication-secret']
var secretReferences = [for name in secretNames: {
  name: name
  keyVaultUrl: '${vaultUri}secrets/${name}'
  identity: identityId
}]
resource app 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'trace-app'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: port
        transport: 'auto'
        allowInsecure: false
      }
      registries: isPlaceholder ? [] : [{ server: registryServer, identity: identityId }]
      secrets: isPlaceholder ? [] : secretReferences
    }
    template: {
      containers: [{
        name: 'trace'
        image: containerImage
        resources: { cpu: 1, memory: '2Gi' }
        env: isPlaceholder ? [] : [
          { name: 'PORT', value: '8080' }
          { name: 'NODE_ENV', value: 'production' }
          { name: 'TRACE_HOSTED', value: '1' }
          { name: 'TRACE_BROWSER_CHANNEL', value: 'chromium' }
          { name: 'TRACE_DATA_DIR', value: '/app/storage' }
          { name: 'TRACE_PUBLIC_ORIGIN', value: 'https://trace-app.${environmentDomain}' }
          { name: 'TRACE_RUNNER_KEY', secretRef: 'runner-key' }
          { name: 'TRACE_PASSWORD_HASH', secretRef: 'password-hash' }
          { name: 'TRACE_SESSION_SECRET', secretRef: 'session-secret' }
          { name: 'TRACE_ENTRA_AUTH', value: empty(entraClientId) ? '0' : '1' }
          { name: 'TRACE_ENTRA_ALLOWED_OBJECT_ID', value: entraAllowedObjectId }
          { name: 'AZURE_CLIENT_ID', value: identityClientId }
          { name: 'AZURE_OPENAI_ENDPOINT', value: aiEndpoint }
          { name: 'AZURE_OPENAI_DEPLOYMENT', value: aiDeployment }
        ]
        volumeMounts: isPlaceholder ? [] : [{ volumeName: 'trace-data', mountPath: '/app/storage' }]
        probes: isPlaceholder ? [] : [
          { type: 'Startup', httpGet: { path: '/api/health', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 5, failureThreshold: 30 }
          { type: 'Liveness', httpGet: { path: '/api/health', port: 8080 }, periodSeconds: 30, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/api/health', port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
        ]
      }]
      volumes: isPlaceholder ? [] : [{ name: 'trace-data', storageType: 'AzureFile', storageName: 'trace-data' }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}
output url string = 'https://${app.properties.configuration.ingress.fqdn}'

resource authentication 'Microsoft.App/containerApps/authConfigs@2026-07-01' = if (!empty(entraClientId)) {
  parent: app
  name: 'current'
  properties: {
    platform: { enabled: true }
    httpSettings: { requireHttps: true }
    globalValidation: {
      excludedPaths: ['/api/health']
      redirectToProvider: 'azureactivedirectory'
      unauthenticatedClientAction: 'RedirectToLoginPage'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'microsoft-provider-authentication-secret'
          openIdIssuer: 'https://login.microsoftonline.com/${entraTenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [entraClientId, 'api://${entraClientId}']
          defaultAuthorizationPolicy: {
            allowedPrincipals: { identities: [entraAllowedObjectId] }
          }
        }
      }
    }
    login: { preserveUrlFragmentsForLogins: true }
  }
}
