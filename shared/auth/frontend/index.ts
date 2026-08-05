// shared/auth — browser surface.
//
// The authenticated HTTP client and its response helper. Nothing here reads
// application state or imports a store; it is transport only.

export { api, unwrap, API_BASE_URL } from './authenticated-api-client';
