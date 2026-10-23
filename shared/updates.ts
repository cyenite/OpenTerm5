export const releasesUrl = 'https://github.com/cyenite/OpenTerm5/releases';

export const updatePhases = [
  { key: 'idle', label: 'Not checked yet' },
  { key: 'checking', label: 'Checking for updates' },
  { key: 'current', label: 'Up to date' },
  { key: 'available', label: 'Update available' },
  { key: 'downloading', label: 'Downloading update' },
  { key: 'downloaded', label: 'Ready to install' },
  { key: 'error', label: 'Update failed' },
  { key: 'unsupported', label: 'Updates unavailable in this build' },
] as const;

export type UpdatePhase = (typeof updatePhases)[number]['key'];

export interface UpdateState {
  readonly phase: UpdatePhase;
  readonly error: string | null;
  readonly version: string | null;
  readonly percent: number;
  readonly releaseUrl: string;
  readonly canInstall: boolean;
  readonly isAutomatic: boolean;
}

export interface UpdateSettings {
  readonly isAutomatic: boolean;
}

export interface UpdateMethods {
  'updates.state': [Record<string, never>, UpdateState];
  'updates.check': [Record<string, never>, UpdateState];
  'updates.install': [Record<string, never>, UpdateState];
  'updates.download': [Record<string, never>, UpdateState];
  'updates.openRelease': [Record<string, never>, boolean];
  'updates.setAutomatic': [{ isAutomatic: boolean }, UpdateState];
}

export type UpdateMethod = keyof UpdateMethods;

export interface UpdateEvents {
  state: UpdateState;
}

export type UpdateEvent = keyof UpdateEvents;

export interface UpdateApi {
  request<M extends UpdateMethod>(method: M, params: UpdateMethods[M][0]): Promise<UpdateMethods[M][1]>;
  on<E extends UpdateEvent>(event: E, listener: (data: UpdateEvents[E]) => void): () => void;
}

export function releaseUrl(version: string | null): string {
  return version ? `${releasesUrl}/tag/v${version}` : `${releasesUrl}/latest`;
}
