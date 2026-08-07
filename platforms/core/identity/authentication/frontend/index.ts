// Core Identity — authentication frontend surface.
//
// Publishes the authentication state binding only. Login, password recovery,
// session and onboarding screens have NOT migrated; they remain legacy routes.

export { useAuthStore } from './state/auth-store.adapter';
