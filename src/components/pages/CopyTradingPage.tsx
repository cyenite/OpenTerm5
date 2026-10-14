import { useEffect, useMemo, useState } from 'react';
import type { CopierConfig, CopierStatus, FollowerConfig, TradingWindow } from '../../../shared/automation';
import { copierRiskTypes, guardActions } from '../../../shared/automation';
import { accountLabel, automation, automationStore } from '../../lib/automation';
import { formatTime } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { EmptyState, NumberField, Section, Segmented, SelectField, StatusPill, Switch, TextField } from '../ui/Controls';
import { UnlockRow } from '../ui/UnlockRow';

const statusOptions = [
  { key: 'enabled', label: 'Enabled' },
  { key: 'monitorExisting', label: 'Monitor existing' },
  { key: 'disabled', label: 'Disabled' },
] as const satisfies readonly { key: CopierStatus; label: string }[];

const followerTabs = [
  { key: 'risk', label: 'Risk' },
  { key: 'stops', label: 'SL / TP' },
  { key: 'filters', label: 'Filters' },
  { key: 'symbols', label: 'Symbols' },
  { key: 'schedule', label: 'Hours' },
  { key: 'protection', label: 'Protection' },
] as const;

type FollowerTab = (typeof followerTabs)[number]['key'];

const filterModes = [
  { key: 'off', label: 'Off' },
  { key: 'copy', label: 'Copy only' },
  { key: 'ignore', label: 'Ignore' },
] as const;

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const newId = () => crypto.randomUUID();

function newFollower(accountId: string): FollowerConfig {
  return {
    id: newId(), accountId, status: 'enabled', riskType: 'lotMultiplier', comment: 'copy', customComment: '', side: 'all',
    symbolMap: {}, magicFilter: { mode: 'off', values: [] }, commentFilter: { mode: 'off', values: [] }, symbolFilter: { mode: 'off', values: [] },
    tradingHours: [], delay: { minMs: 0, maxMs: 0 }, lotFilter: { min: 0, max: 0 }, equityProtection: { minEquity: 0, maxDailyLossPercent: 0, action: 'blockNew' },
    stopMode: 'price', riskValue: 100, lotRefiner: 0, fixedStopPips: 0, fixedTargetPips: 0, stopRefinePips: 0, targetRefinePips: 0, fixedMasterBalance: 0,
    maxOpenTrades: 0, isReversed: false, isStopCopied: true, isTargetCopied: true, isPendingCopied: false, isExpiryCopied: true, isStrictClose: false,
    isExistingCopied: false, isMinimumForced: false, isMaximumForced: false, isContractAligned: true, isSuffixAutoMapped: true,
  };
}

const parseList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

interface SymbolMapEditorProps {
  follower: FollowerConfig;
  onChange: (follower: FollowerConfig) => void;
}

function SymbolMapEditor({ follower, onChange }: SymbolMapEditorProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    automation.request('copier.symbols', { accountId: follower.accountId }).then(setSymbols).catch((reason: Error) => setError(reason.message));
  }, [follower.accountId]);
  const entries = Object.entries(follower.symbolMap);
  return (
    <div className="stack">
      <Switch label="Auto-map broker suffixes" hint="EURUSD on the master finds EURUSD.m or EURUSDpro on the follower. Explicit mappings below win." isOn={follower.isSuffixAutoMapped} onChange={(isSuffixAutoMapped) => onChange({ ...follower, isSuffixAutoMapped })} />
      <div className="map-add">
        <input aria-label="Master symbol" placeholder="Master symbol (e.g. DE40)" value={from} onChange={(event) => setFrom(event.target.value.trim())} />
        <span aria-hidden>→</span>
        <input aria-label="Follower symbol" list="follower-symbols" placeholder="Follower symbol (e.g. GER40)" value={to} onChange={(event) => setTo(event.target.value.trim())} />
        <datalist id="follower-symbols">{symbols.map((name) => <option key={name} value={name} />)}</datalist>
        <button type="button" disabled={!from || !to} onClick={() => { onChange({ ...follower, symbolMap: { ...follower.symbolMap, [from]: to } }); setFrom(''); setTo(''); }}>Add mapping</button>
      </div>
      {to && symbols.length > 0 && !symbols.includes(to) && <p className="is-loss">The follower broker has no symbol named {to}.</p>}
      {error && <p className="is-muted">Follower symbols unavailable: {error}</p>}
      {entries.length ? (
        <table className="grid compact">
          <thead><tr><th>Master</th><th>Follower</th><th /></tr></thead>
          <tbody>
            {entries.map(([master, target]) => (
              <tr key={master}>
                <td>{master}</td>
                <td>{target}</td>
                <td><button className="link-button" type="button" onClick={() => { const { [master]: _removed, ...rest } = follower.symbolMap; onChange({ ...follower, symbolMap: rest }); }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="is-muted">No explicit mappings. Matching names copy automatically.</p>}
    </div>
  );
}

interface HoursEditorProps {
  windows: TradingWindow[];
  onChange: (windows: TradingWindow[]) => void;
}

function HoursEditor({ windows, onChange }: HoursEditorProps) {
  return (
    <div className="stack">
      <p className="is-muted">New trades are copied only inside these local-time windows. Existing copies keep being managed and closed outside them. No windows means always on.</p>
      {windows.map((window, index) => (
        <div className="hours-row" key={index}>
          <select aria-label="Day" value={window.day} onChange={(event) => onChange(windows.map((item, position) => position === index ? { ...item, day: Number(event.target.value) } : item))}>
            {weekdays.map((day, value) => <option key={day} value={value}>{day}</option>)}
          </select>
          <input aria-label="Start" type="time" value={window.start} onChange={(event) => onChange(windows.map((item, position) => position === index ? { ...item, start: event.target.value } : item))} />
          <span>to</span>
          <input aria-label="End" type="time" value={window.end} onChange={(event) => onChange(windows.map((item, position) => position === index ? { ...item, end: event.target.value } : item))} />
          <button className="link-button" type="button" onClick={() => onChange(windows.filter((_, position) => position !== index))}>Remove</button>
        </div>
      ))}
      <div className="button-row">
        <button type="button" onClick={() => onChange([...windows, { day: 1, start: '08:00', end: '17:00' }])}>Add window</button>
        <button type="button" onClick={() => onChange([1, 2, 3, 4, 5].map((day) => ({ day, start: '08:00', end: '17:00' })))}>Weekdays 08-17</button>
      </div>
    </div>
  );
}

interface FollowerEditorProps {
  follower: FollowerConfig;
  onChange: (follower: FollowerConfig) => void;
}

function FollowerEditor({ follower, onChange }: FollowerEditorProps) {
  const [tab, setTab] = useState<FollowerTab>('risk');
  const set = (patch: Partial<FollowerConfig>) => onChange({ ...follower, ...patch });
  const riskType = copierRiskTypes.find((type) => type.key === follower.riskType)!;
  const isPercent = follower.riskType !== 'fixedLot';
  return (
    <div className="follower-editor">
      <Segmented label="Follower settings" value={tab} options={followerTabs} onChange={setTab} />
      {tab === 'risk' && (
        <div className="form-grid">
          <SelectField label="Risk type" value={follower.riskType} hint={riskType.hint} options={copierRiskTypes} onChange={(value) => set({ riskType: value })} />
          <NumberField label={isPercent ? 'Risk setting' : 'Lots'} value={follower.riskValue} step={isPercent ? 1 : 0.01} suffix={isPercent ? '%' : 'lots'} hint={follower.riskType === 'fixedRisk' ? 'Percent of follower balance lost if the stop is hit.' : isPercent ? '100% is a 1:1 copy.' : undefined} onChange={(riskValue) => set({ riskValue })} />
          {follower.riskType === 'fixedBalance' && <NumberField label="Fixed master balance" value={follower.fixedMasterBalance} step={1000} onChange={(fixedMasterBalance) => set({ fixedMasterBalance })} />}
          <NumberField label="Lot refiner" value={follower.lotRefiner} step={0.01} min={-100} suffix="lots" hint="Added to every calculated volume; can be negative." onChange={(lotRefiner) => set({ lotRefiner })} />
          <NumberField label="Max open copies" value={follower.maxOpenTrades} hint="0 means no limit." onChange={(maxOpenTrades) => set({ maxOpenTrades })} />
          <NumberField label="Delay from" value={follower.delay.minMs} step={50} suffix="ms" onChange={(minMs) => set({ delay: { ...follower.delay, minMs } })} />
          <NumberField label="Delay to" value={follower.delay.maxMs} step={50} suffix="ms" hint="A random delay in this range is added to every action." onChange={(maxMs) => set({ delay: { ...follower.delay, maxMs } })} />
          <Switch label="Force minimum lot" hint="Trade the symbol minimum instead of skipping a too-small copy." isOn={follower.isMinimumForced} onChange={(isMinimumForced) => set({ isMinimumForced })} />
          <Switch label="Force maximum lot" hint="Cap at the symbol maximum instead of failing." isOn={follower.isMaximumForced} onChange={(isMaximumForced) => set({ isMaximumForced })} />
          <Switch label="Contract alignment" hint="Adjust for different contract sizes per lot between brokers." isOn={follower.isContractAligned} onChange={(isContractAligned) => set({ isContractAligned })} />
          <Switch label="Reverse trades" hint="Buys become sells. Master stops are not copied when reversed." isOn={follower.isReversed} onChange={(isReversed) => set({ isReversed })} />
          <Switch label="Copy existing trades" hint="Also copy positions already open on the master when this follower starts." isOn={follower.isExistingCopied} onChange={(isExistingCopied) => set({ isExistingCopied })} />
        </div>
      )}
      {tab === 'stops' && (
        <div className="form-grid">
          <Switch label="Copy stop loss" isOn={follower.isStopCopied} onChange={(isStopCopied) => set({ isStopCopied })} />
          <Switch label="Copy take profit" isOn={follower.isTargetCopied} onChange={(isTargetCopied) => set({ isTargetCopied })} />
          <SelectField label="Stop placement" value={follower.stopMode} hint="Distance keeps the master's pip distance from the follower's own fill, which survives price differences between brokers." options={[{ key: 'price', label: 'Same price as master' }, { key: 'distance', label: 'Same distance from entry' }]} onChange={(stopMode) => set({ stopMode })} />
          <NumberField label="Fixed stop loss" value={follower.fixedStopPips} suffix="pips" hint="Applied to every copy; 0 is off." onChange={(fixedStopPips) => set({ fixedStopPips })} />
          <NumberField label="Fixed take profit" value={follower.fixedTargetPips} suffix="pips" onChange={(fixedTargetPips) => set({ fixedTargetPips })} />
          <NumberField label="Stop refinement" value={follower.stopRefinePips} min={-1000} suffix="pips" hint="Moves the copied stop further away (negative brings it closer)." onChange={(stopRefinePips) => set({ stopRefinePips })} />
          <NumberField label="Target refinement" value={follower.targetRefinePips} min={-1000} suffix="pips" onChange={(targetRefinePips) => set({ targetRefinePips })} />
          <Switch label="Copy pending orders" hint="Otherwise a filled master order is copied at market." isOn={follower.isPendingCopied} onChange={(isPendingCopied) => set({ isPendingCopied })} />
          <Switch label="Copy expiry time" isOn={follower.isExpiryCopied} onChange={(isExpiryCopied) => set({ isExpiryCopied })} />
          <Switch label="Strict close" hint="Ignore master closes: copies only close at their own stops. Requires stops." isOn={follower.isStrictClose} onChange={(isStrictClose) => set({ isStrictClose })} />
          <SelectField label="Trade comment" value={follower.comment} options={[{ key: 'copy', label: 'Copy master comment' }, { key: 'none', label: 'No comment' }, { key: 'custom', label: 'Custom' }]} onChange={(comment) => set({ comment })} />
          {follower.comment === 'custom' && <TextField label="Custom comment" value={follower.customComment} onChange={(customComment) => set({ customComment: customComment.slice(0, 31) })} />}
        </div>
      )}
      {tab === 'filters' && (
        <div className="form-grid">
          <SelectField label="Trade side" value={follower.side} options={[{ key: 'all', label: 'Buy and sell' }, { key: 'buy', label: 'Buys only' }, { key: 'sell', label: 'Sells only' }]} onChange={(side) => set({ side })} />
          <NumberField label="Master lots from" value={follower.lotFilter.min} step={0.01} hint="0 means no lower bound." onChange={(min) => set({ lotFilter: { ...follower.lotFilter, min } })} />
          <NumberField label="Master lots to" value={follower.lotFilter.max} step={0.01} hint="0 means no upper bound." onChange={(max) => set({ lotFilter: { ...follower.lotFilter, max } })} />
          <SelectField label="Magic numbers" value={follower.magicFilter.mode} options={filterModes} onChange={(mode) => set({ magicFilter: { ...follower.magicFilter, mode } })} />
          <TextField label="Magic list" placeholder="10, 20" value={follower.magicFilter.values.join(', ')} onChange={(value) => set({ magicFilter: { ...follower.magicFilter, values: parseList(value).map(Number).filter(Number.isInteger) } })} />
          <SelectField label="Comments" value={follower.commentFilter.mode} options={filterModes} onChange={(mode) => set({ commentFilter: { ...follower.commentFilter, mode } })} />
          <TextField label="Comment list" placeholder="robot 1, robot 2" value={follower.commentFilter.values.join(', ')} onChange={(value) => set({ commentFilter: { ...follower.commentFilter, values: parseList(value) } })} />
          <SelectField label="Symbols" value={follower.symbolFilter.mode} options={filterModes} onChange={(mode) => set({ symbolFilter: { ...follower.symbolFilter, mode } })} />
          <TextField label="Symbol list" placeholder="EURUSD, XAUUSD" value={follower.symbolFilter.values.join(', ')} onChange={(value) => set({ symbolFilter: { ...follower.symbolFilter, values: parseList(value) } })} />
        </div>
      )}
      {tab === 'symbols' && <SymbolMapEditor follower={follower} onChange={onChange} />}
      {tab === 'schedule' && <HoursEditor windows={follower.tradingHours} onChange={(tradingHours) => set({ tradingHours })} />}
      {tab === 'protection' && (
        <div className="form-grid">
          <NumberField label="Minimum equity" value={follower.equityProtection.minEquity} step={100} hint="Stop copying when follower equity falls below this. 0 is off." onChange={(minEquity) => set({ equityProtection: { ...follower.equityProtection, minEquity } })} />
          <NumberField label="Max daily loss" value={follower.equityProtection.maxDailyLossPercent} step={0.5} suffix="%" hint="Of the day's starting equity. 0 is off." onChange={(maxDailyLossPercent) => set({ equityProtection: { ...follower.equityProtection, maxDailyLossPercent } })} />
          <SelectField label="When tripped" value={follower.equityProtection.action} options={guardActions} onChange={(action) => set({ equityProtection: { ...follower.equityProtection, action } })} />
        </div>
      )}
    </div>
  );
}

interface CopierEditorProps {
  draft: CopierConfig;
  isSaved: boolean;
  onChange: (config: CopierConfig) => void;
  onSaved: (config: CopierConfig) => void;
  onDeleted: () => void;
}

function CopierEditor({ draft, isSaved, onChange, onSaved, onDeleted }: CopierEditorProps) {
  const accounts = useStore(session, (state) => state.accounts);
  const view = useStore(automationStore, (state) => state.copier);
  const [selected, setSelected] = useState<string | null>(draft.followers[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const stored = view.configs.find((config) => config.id === draft.id);
  const isDirty = !stored || JSON.stringify(stored) !== JSON.stringify(draft);
  const follower = draft.followers.find((item) => item.id === selected);
  const linkState = (accountId: string) => view.links.find((link) => link.accountId === accountId);
  const openCopies = (followerId: string) => view.mappings.filter((mapping) => mapping.copierId === draft.id && mapping.followerId === followerId && mapping.status === 'open').length;
  const candidates = accounts.filter((profile) => profile.id !== draft.masterId && !draft.followers.some((item) => item.accountId === profile.id));
  const nameOf = (id: string) => accounts.find((profile) => profile.id === id)?.label ?? accountLabel(id);

  const save = async () => {
    setIsBusy(true);
    setError(null);
    try { onSaved(await automation.request('copier.save', draft)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setIsBusy(false); }
  };

  return (
    <div className="page-scroll">
      <Section
        title={draft.name || 'New copier'}
        detail="One master, any number of followers. Copies run while Terminal5 is open."
        actions={(
          <>
            {isSaved && <button type="button" className="is-danger" onClick={() => { if (window.confirm(`Delete ${draft.name}? Open copies stay open on the follower accounts.`)) void automation.request('copier.remove', { id: draft.id }).then(onDeleted); }}>Delete</button>}
            <button type="button" className="is-primary" disabled={isBusy || !isDirty} onClick={save}>{isDirty ? 'Save changes' : 'Saved'}</button>
          </>
        )}
      >
        {error && <p className="banner is-bad">{error}</p>}
        <div className="form-grid">
          <TextField label="Name" value={draft.name} placeholder="Prop firm copier" onChange={(name) => onChange({ ...draft, name })} />
          <SelectField label="Master account" value={draft.masterId} options={[{ key: '', label: 'Choose an account' }, ...accounts.map((profile) => ({ key: profile.id, label: `${profile.label} (${profile.tradeMode})` }))]} hint="Investor (read-only) passwords are enough for a master." onChange={(masterId) => onChange({ ...draft, masterId })} />
          <div className="form-field">
            <span>Status</span>
            <Segmented label="Copier status" value={draft.status} options={statusOptions} onChange={(status) => onChange({ ...draft, status })} />
            <small>Monitor existing ignores new master trades but still closes copies.</small>
          </div>
        </div>
      </Section>
      <Section
        title="Followers"
        detail="Accounts that receive copies. Each has its own risk, filters and protection."
        actions={(
          <div className="inline-form">
            <select aria-label="Add follower account" value="" disabled={!candidates.length} onChange={(event) => { if (!event.target.value) return; const item = newFollower(event.target.value); onChange({ ...draft, followers: [...draft.followers, item] }); setSelected(item.id); }}>
              <option value="">{candidates.length ? '+ Add follower…' : 'No other saved accounts'}</option>
              {candidates.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.server}</option>)}
            </select>
          </div>
        )}
      >
        {draft.followers.length === 0 ? <EmptyState title="No followers yet" detail="Add an account that should receive the master's trades. Log in to it once (File > Accounts) so Terminal5 knows it." /> : (
          <table className="grid selectable">
            <thead><tr><th>Account</th><th>Risk</th><th>Connection</th><th className="num">Open copies</th><th>Status</th><th /></tr></thead>
            <tbody>
              {draft.followers.map((item) => (
                <tr key={item.id} className={item.id === selected ? 'is-selected' : ''} onClick={() => setSelected(item.id)}>
                  <td>{nameOf(item.accountId)}</td>
                  <td>{copierRiskTypes.find((type) => type.key === item.riskType)?.label} {item.riskValue}{item.riskType === 'fixedLot' ? ' lots' : '%'}</td>
                  <td><StatusPill status={linkState(item.accountId)?.state ?? 'idle'} /></td>
                  <td className="num">{openCopies(item.id)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <select aria-label="Follower status" value={item.status} onChange={(event) => onChange({ ...draft, followers: draft.followers.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as CopierStatus } : entry) })}>
                      {statusOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                    </select>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}><button className="link-button" type="button" onClick={() => onChange({ ...draft, followers: draft.followers.filter((entry) => entry.id !== item.id) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.protections.filter((item) => item.trippedAt && draft.followers.some((entry) => entry.id === item.followerId)).map((item) => (
          <p key={item.followerId} className="banner is-bad">
            Protection tripped for {nameOf(draft.followers.find((entry) => entry.id === item.followerId)!.accountId)}: {item.reason}.{' '}
            <button className="link-button" type="button" onClick={() => void automation.request('copier.resetProtection', { followerId: item.followerId })}>Reset</button>
          </p>
        ))}
      </Section>
      {follower && (
        <Section title={`Settings for ${nameOf(follower.accountId)}`}>
          <FollowerEditor follower={follower} onChange={(next) => onChange({ ...draft, followers: draft.followers.map((item) => item.id === next.id ? next : item) })} />
        </Section>
      )}
      {isSaved && <CopierActivity copierId={draft.id} nameOf={(followerId) => nameOf(draft.followers.find((item) => item.id === followerId)?.accountId ?? followerId)} />}
    </div>
  );
}

interface CopierActivityProps {
  copierId: string;
  nameOf: (followerId: string) => string;
}

function CopierActivity({ copierId, nameOf }: CopierActivityProps) {
  const view = useStore(automationStore, (state) => state.copier);
  const [tab, setTab] = useState<'copies' | 'log'>('copies');
  const mappings = view.mappings.filter((mapping) => mapping.copierId === copierId);
  const logs = view.logs.filter((entry) => entry.copierId === copierId || entry.copierId === '');
  return (
    <Section title="Activity" actions={<Segmented label="Activity view" value={tab} options={[{ key: 'copies', label: `Copies (${mappings.length})` }, { key: 'log', label: 'Log' }]} onChange={setTab} />}>
      {tab === 'copies' ? (
        mappings.length ? (
          <table className="grid compact">
            <thead><tr><th>Follower</th><th>Symbol</th><th>Kind</th><th className="num">Master #</th><th className="num">Copy #</th><th className="num">Lots</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>{nameOf(mapping.followerId)}</td>
                  <td>{mapping.symbol}</td>
                  <td>{mapping.kind}</td>
                  <td className="num">{mapping.masterTicket}</td>
                  <td className="num">{mapping.followerTicket || ''}</td>
                  <td className="num">{mapping.masterVolume} → {mapping.followerVolume || '-'}</td>
                  <td><StatusPill status={mapping.status} /></td>
                  <td className="is-muted">{mapping.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="Nothing copied yet" detail="New master trades appear here as soon as they are copied." />
      ) : (
        <table className="grid compact">
          <thead><tr><th>Time</th><th>Follower</th><th>Event</th><th>Status</th><th>Message</th><th className="num">Latency</th></tr></thead>
          <tbody>
            {logs.map((entry) => (
              <tr key={entry.id}>
                <td>{formatTime(entry.time)}</td>
                <td>{entry.followerId ? nameOf(entry.followerId) : ''}</td>
                <td>{entry.event}</td>
                <td><StatusPill status={entry.status} /></td>
                <td>{entry.message}</td>
                <td className="num">{entry.latencyMs !== undefined ? `${entry.latencyMs} ms` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function CopyTradingPage() {
  const view = useStore(automationStore, (state) => state.copier);
  const accounts = useStore(session, (state) => state.accounts);
  const [selectedId, setSelectedId] = useState<string | null>(view.configs[0]?.id ?? null);
  const [draft, setDraft] = useState<CopierConfig | null>(null);
  const selected = useMemo(() => view.configs.find((config) => config.id === selectedId) ?? null, [view.configs, selectedId]);

  useEffect(() => {
    if (!draft || draft.id !== selectedId) setDraft(selected ? structuredClone(selected) : null);
  }, [selected, selectedId, draft]);

  const create = () => {
    const config: CopierConfig = { id: newId(), name: 'New copier', status: 'disabled', masterId: accounts.find((profile) => profile.isActive)?.id ?? '', followers: [], createdAt: Date.now() };
    setSelectedId(config.id);
    setDraft(config);
  };

  return (
    <div className="split-page">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Copiers</h2>
          <button type="button" className="is-primary" onClick={create}>New</button>
        </div>
        <ul className="sidebar-list">
          {view.configs.map((config) => (
            <li key={config.id}>
              <button type="button" className={config.id === selectedId ? 'is-active' : ''} onClick={() => setSelectedId(config.id)}>
                <span className="sidebar-title">{config.name}</span>
                <span className="sidebar-meta">
                  {accounts.find((profile) => profile.id === config.masterId)?.label ?? accountLabel(config.masterId)} → {config.followers.length} follower{config.followers.length === 1 ? '' : 's'}
                </span>
                <StatusPill status={config.status} label={statusOptions.find((option) => option.key === config.status)?.label} />
              </button>
            </li>
          ))}
          {draft && !view.configs.some((config) => config.id === draft.id) && (
            <li><button type="button" className="is-active"><span className="sidebar-title">{draft.name}</span><span className="sidebar-meta">Unsaved</span></button></li>
          )}
        </ul>
        <div className="sidebar-header"><h2>Connections</h2></div>
        <ul className="session-list">
          {view.links.length ? view.links.map((link) => <UnlockRow key={link.accountId} accountId={link.accountId} state={link.state} error={link.error} />) : <li className="is-muted">Accounts connect when a copier is enabled.</li>}
        </ul>
      </aside>
      <div className="page-main">
        {draft ? (
          <CopierEditor key={draft.id} draft={draft} isSaved={view.configs.some((config) => config.id === draft.id)} onChange={setDraft} onSaved={(config) => { setDraft(structuredClone(config)); setSelectedId(config.id); }} onDeleted={() => { setSelectedId(null); setDraft(null); }} />
        ) : (
          <EmptyState title="Copy trades between your accounts" detail="Create a copier, choose a master account and add followers. Risk, symbol mapping, filters, trading hours and equity protection are set per follower." action={<button type="button" className="is-primary" onClick={create}>Create a copier</button>} />
        )}
      </div>
    </div>
  );
}
