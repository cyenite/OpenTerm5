import type { AccountProfile } from '../../shared/protocol';
import { log, refreshSession, session, signingIn, terminal } from './session';
import { openDialog } from './workspace';

export async function connectProfile(profile: AccountProfile): Promise<void> {
  if (signingIn(session.get())) return;
  if (!profile.hasPassword) { openDialog({ kind: 'login', profileId: profile.id }); return; }
  try {
    await terminal.request('accounts.connect', { id: profile.id });
    await refreshSession();
  } catch (error) {
    log(`${profile.label || profile.login}: ${(error as Error).message}`, 'Accounts');
    openDialog({ kind: 'login', profileId: profile.id });
  }
}

export async function removeProfile(profile: AccountProfile): Promise<void> {
  if (!window.confirm(`Remove ${profile.label || profile.login} (${profile.server}) and its saved password from this computer?`)) return;
  try { await terminal.request('accounts.remove', { id: profile.id }); }
  catch (error) { log(`${profile.label || profile.login}: ${(error as Error).message}`, 'Accounts'); }
}
