import type { CopierConfig, CopierLogEntry } from '../shared/automation';
import type { CopyMapping } from './copier';

export interface AuditAccount {
  id: string;
  label?: string;
  holder?: string;
  server?: string;
  company?: string;
  login?: number;
}

export interface CopierAudit {
  format: 'openterm5.copier-audit';
  about: string;
  version: 1;
  clientId: string;
  exportedAt: string;
  appVersion: string;
  log: (Omit<CopierLogEntry, 'time'> & { time: string })[];
  copies: (Omit<CopyMapping, 'createdAt'> & { createdAt: string })[];
  copiers: CopierConfig[];
  accounts: AuditAccount[];
}

export interface AuditInput {
  copierId?: string;
  clientId: string;
  appVersion: string;
  exportedAt: number;
  log: readonly CopierLogEntry[];
  configs: readonly CopierConfig[];
  mappings: readonly CopyMapping[];
  account: (id: string) => AuditAccount;
}

const ABOUT = 'Trade copier record exported from OpenTerm5, a desktop MetaTrader 5 terminal. Every copy pairs a master ticket with a follower ticket, '
  + 'and both can be checked against the broker\'s own history. Times are UTC. clientId is the device identifier this installation sends at every MT5 login.';

const iso = (time: number) => new Date(time).toISOString();

export function buildCopierAudit(input: AuditInput): CopierAudit {
  const configs = input.configs.filter((config) => !input.copierId || config.id === input.copierId);
  const ids = new Set(configs.map((config) => config.id));
  const accountIds = new Set(configs.flatMap((config) => [config.masterId, ...config.followers.map((follower) => follower.accountId)]));
  return {
    format: 'openterm5.copier-audit',
    about: ABOUT,
    version: 1,
    clientId: input.clientId,
    exportedAt: iso(input.exportedAt),
    appVersion: input.appVersion,
    log: input.log.filter((entry) => ids.has(entry.copierId)).map((entry) => ({ ...entry, time: iso(entry.time) })),
    copies: input.mappings.filter((mapping) => ids.has(mapping.copierId)).map((mapping) => ({ ...mapping, createdAt: iso(mapping.createdAt) })),
    copiers: configs,
    accounts: [...accountIds].map(input.account),
  };
}
