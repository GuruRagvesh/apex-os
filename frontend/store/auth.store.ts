import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  photoUrl?: string;
  bio?: string;
  mustChangePassword?: boolean;
  role: { id: string; name: string; level: number };
  department?: { id: string; name: string; color: string };
}

interface AuthState {
  user:             User | null;
  token:            string | null;
  isAuthenticated:  boolean;
  hasHydrated:      boolean;
  setAuth:          (user: User, token: string) => void;
  logout:           () => void;
  updateUser:       (user: Partial<User>) => void;
  setHasHydrated:   (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      token:           null,
      isAuthenticated: false,
      hasHydrated:     false,

      setAuth: (user, token) => {
        localStorage.setItem('apex_token', token);
        set({ user, token, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem('apex_token');
        localStorage.removeItem('apexMode');
        set({ user: null, token: null, isAuthenticated: false });
      },

      updateUser: (updates) =>
        set((state) => ({ user: state.user ? { ...state.user, ...updates } : null })),

      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'apex-auth',
      partialize: (state) => ({
        user:            state.user,
        token:           state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
