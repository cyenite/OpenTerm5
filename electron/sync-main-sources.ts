import type { Json } from '../shared/sync';
import type { AccountRegistry } from './account-registry';
import type { AutomationHost } from './automation-host';
import type { DeviceIdentity } from './device-identity';
import { SyncSourceUnavailableError, type SyncSource } from './sync-engine';

// The stores the main process holds, as sync sources. Secrets are handled here and never reach the
// renderer: sync decrypts them from the keychain only to encrypt them under its own key.

export const IDENTITY_ID = 'cid';
export const WEBHOOKS_ID = 'webhooks';

export interface MainSourcesDeps {
  readonly accounts: () => AccountRegistry | undefined;
  readonly automation: () => AutomationHost | undefined;
  readonly device: DeviceIdentity;
  readonly onAccountsChanged: () => void;
  readonly journal: (message: string) => void;
}

const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

// Saved accounts that failed to load read as none at all; syncing that would delete them on
// every computer, so sync stops and says why instead.
function registryOf(deps: MainSourcesDeps): AccountRegistry {
  const registry = deps.accounts();
  if (!registry) throw new Error('Saved accounts could not be read on this computer, so sync is paused. Restart OpenTerm5 to try again.');
  return registry;
}

function automationOf(deps: MainSourcesDeps): AutomationHost {
  const automation = deps.automation();
  if (!automation) throw new SyncSourceUnavailableError('Automation is still starting.');
  return automation;
}

function singleton(id: string, expected: string): void {
  if (id !== expected) throw new Error(`Unknown record ${id}.`);
}

export function mainSyncSources(deps: MainSourcesDeps): SyncSource[] {
  return [
    {
      kind: 'account',
      snapshot: async () => toJson(registryOf(deps).syncedProfiles()) as Record<string, Json>,
      validate: (value, id) => registryOf(deps).checkSyncedProfile(id, value),
      apply: async (change) => {
        await registryOf(deps).applySyncedProfiles(change);
        deps.onAccountsChanged();
      },
    },
    {
      kind: 'accountSecret',
      snapshot: async () => toJson(registryOf(deps).syncedSecrets()) as Record<string, Json>,
      validate: (value, id) => registryOf(deps).checkSyncedSecret(id, value),
      apply: async (change) => {
        await registryOf(deps).applySyncedSecrets(change);
        deps.onAccountsChanged();
      },
    },
    {
      kind: 'identity',
      snapshot: async () => ({ [IDENTITY_ID]: deps.device.syncRecord() }),
      validate: (value, id) => {
        singleton(id, IDENTITY_ID);
        const { cid, isUnique } = (value ?? {}) as { cid?: unknown; isUnique?: unknown };
        if (typeof cid !== 'string' || !/^[0-9a-f]{32}$/.test(cid) || typeof isUnique !== 'boolean') throw new Error('Invalid client ID.');
      },
      // The CID is never removed, only replaced.
      apply: async (change) => {
        const value = change.upserts[IDENTITY_ID];
        if (value !== undefined && await deps.device.setFromSync(value)) deps.journal('This computer now uses the CID of your other computers. It applies from the next login.');
      },
    },
    {
      kind: 'webhookSecrets',
      // Unreadable settings are offered as a record that fails its checks, so it is left alone.
      snapshot: async () => ({ [WEBHOOKS_ID]: toJson(automationOf(deps).syncedWebhooks() ?? { isUnreadable: true }) }),
      validate: (value, id) => {
        singleton(id, WEBHOOKS_ID);
        automationOf(deps).checkSyncedWebhooks(value);
      },
      // Webhook settings are never removed as a whole.
      apply: async (change) => {
        const value = change.upserts[WEBHOOKS_ID];
        if (value !== undefined) await automationOf(deps).applySyncedWebhooks(value);
      },
    },
  ];
}
