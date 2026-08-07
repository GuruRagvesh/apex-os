// Core Identity — authentication state adapter.
//
// This is a RE-EXPORT, not a wrapper. It publishes the existing legacy Zustand
// store unchanged so platform components can consume authentication state
// through a component boundary instead of reaching into frontend/store/.
//
// WHAT THIS FILE MUST NEVER DO
// ---------------------------
// - create a second Zustand store (two stores means two persisted states)
// - wrap, select, memoise or transform any part of the store
// - add a hook around it
// - change hydration timing
//
// Any of those would alter authentication behaviour. The store's rehydration
// timing in particular is load-bearing: frontend/app/(dashboard)/layout.tsx
// records that redirecting while `hasHydrated` is false is what logged users
// out on every refresh. Twelve consumers gate on that flag.
//
// The legacy store also has an implicit contract with shared/auth that is
// invisible to the import graph: both touch the same localStorage keys.
// auth.store writes `apex_token` on setAuth and clears it on logout; the
// authenticated client reads it per request and, on 401, clears both
// `apex_token` and the `apex-auth` persist key before hard-navigating to
// /login?expired=true. Nothing here may disturb that.
//
// The single import below is tracked as DEBT-P7-CORE-IDENTITY-AUTH-STORE and is
// scoped to this exact file. It disappears when the store itself moves into
// ./ (frontend/state/), which is a separate, staging-validated phase.

export { useAuthStore } from '@/store/auth.store';
