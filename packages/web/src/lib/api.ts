// Barrel: el API client real vive en ./api/ — split en types/client/settings/endpoints.
// Mantener este re-export para que `import ... from '$lib/api'` siga funcionando.
export * from './api/index.js';
