export {
  getSecret,
  getOptionalSecret,
  staticConfig,
  type StaticConfig,
} from "./manager";
export * from "./known-secrets";
export {
  getTenantSecret,
  setTenantSecret,
  rotateTenantSecret,
  deleteTenantSecret,
  __resetMasterKeyCacheForTests,
  __setSecretsBackendForTests,
  type SecretsBackend,
} from "./tenantSecrets";
