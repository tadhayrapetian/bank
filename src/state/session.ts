/** Session state: the signed-in user and their permissions. */
import { create } from 'zustand';
import { permissionsOf, type Permission } from '@/core/security/permissions';
import type { User } from '@/core/types';

interface SessionState {
  user: User | null;
  perms: Set<Permission>;
  ready: boolean;
  persistent: boolean;
  setUser: (u: User | null) => void;
  setReady: (persistent: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  perms: new Set(),
  ready: false,
  persistent: true,
  setUser: (user) => set({ user, perms: user ? permissionsOf(user.roles) : new Set() }),
  setReady: (persistent) => set({ ready: true, persistent }),
}));

export function useCan(p: Permission): boolean {
  return useSession((s) => s.perms.has(p));
}
