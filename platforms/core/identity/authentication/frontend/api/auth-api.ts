// Core Identity Authentication — auth HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, unwrap and return value is unchanged: this is a
// transport relocation, not a refactor.
//
// TRANSPORT ONLY. THIS FILE HOLDS NO AUTH STATE.
// ----------------------------------------------
// That separation is the whole reason this move is low risk, and it must not
// erode. These five methods send a request and unwrap a response. They do not
// touch localStorage, do not write the store, do not redirect and do not
// decide anything.
//
// The stateful half stays exactly where it is, in frontend/store/auth.store.ts
// reached through '@apex/core-identity':
//
//   apex_token         written by setAuth, removed by logout
//   apexMode           removed by logout
//   apex-auth          the Zustand persist name
//   hasHydrated        the rehydration flag twelve consumers gate on
//
// The call-site contract is unchanged and load-bearing:
//
//   const res = await authApi.login(email, password);   // transport, here
//   setAuth(res.user, res.accessToken);                 // state, in the store
//
// If a future change makes this file call setAuth, persist a token or issue a
// redirect, that is a boundary violation regardless of whether it compiles.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// core/identity/authentication already publishes the authentication state
// binding. The backend agrees: one @Controller('auth') with one authService
// serves all five endpoints. The component's README scopes it to
// authentication and explicitly disclaims role policy, which stays in
// shared/auth.
//
// Published as '@apex/core-identity/api', deliberately NOT through the root
// barrel. That barrel exports useAuthStore, which many consumers want without
// any HTTP; routing transport through it would drag the authenticated client
// into every one of them. The two surfaces stay separate:
//
//   '@apex/core-identity'       auth state / store
//   '@apex/core-identity/api'   auth HTTP transport
//
// me() has no frontend consumer today -- the store holds the current user --
// and the backend's register endpoint deliberately has no transport here at
// all. me() is preserved verbatim under R100 rather than dropped.

import { api, unwrap as r } from '@apex/shared-auth';

export const authApi = {
  login: (email: string, password: string) => r(api.post('/auth/login', { email, password })),
  me: () => r(api.get('/auth/me')),
  changePassword: (currentPassword: string, newPassword: string) =>
    r(api.patch('/auth/change-password', { currentPassword, newPassword })),
  forgotPassword: (email: string) => r(api.post('/auth/forgot-password', { email })),
  resetPassword: (email: string, otp: string, newPassword: string) =>
    r(api.post('/auth/reset-password', { email, otp, newPassword })),
};
