import { useApp } from '../../app/store';

/** Group code from a `?g=` invite link; the League screen consumes it on open. Kept tiny so the menu doesn't pull in the League screen. */
let pending: string | null = null;

export function openGroupLink(code: string) {
  pending = code.toUpperCase();
  useApp.getState().go('league');
}

export function peekPendingGroup(): string | null {
  return pending;
}

export function takePendingGroup(): string | null {
  const c = pending;
  pending = null;
  return c;
}
