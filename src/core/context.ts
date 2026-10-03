/**
 * Execution context — who is acting. Set by the authentication layer on login;
 * every core service reads it for authorisation and the audit trail.
 */
import type { Role } from './types';

export interface Actor {
  userId: string;
  name: string;
  roles: Role[];
  deviceId: string;
  sessionId?: string;
  ip: string;
  system?: boolean;
}

export const SYSTEM_ACTOR: Actor = {
  userId: 'SYSTEM',
  name: 'Exchequer Automaton',
  roles: ['admin'],
  deviceId: 'EXCHEQUER-CORE',
  ip: '10.0.0.1',
  system: true,
};

let current: Actor = SYSTEM_ACTOR;

export function setActor(a: Actor) {
  current = a;
}

export function actor(): Actor {
  return current;
}

/** Run a function as another actor (system jobs, seeding). */
export async function asActor<T>(a: Actor, fn: () => Promise<T>): Promise<T> {
  const prev = current;
  current = a;
  try {
    return await fn();
  } finally {
    current = prev;
  }
}

export function primaryRole(roles: Role[]): Role {
  const order: Role[] = ['admin', 'auditor', 'compliance', 'accountant', 'manager', 'teller', 'client'];
  return order.find((r) => roles.includes(r)) ?? 'client';
}

/** Placeholder IP for the demo — never a real address. */
export function placeholderIp(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `10.${(h >> 16) & 255}.${(h >> 8) & 255}.${h & 255}`;
}
