import { useEffect, useState } from 'react';
import type { AccountGuard, BulkKind, PositionRule } from '../../../shared/automation';
import { bulkKinds, defaultGuard, guardActions } from '../../../shared/automation';
import type { NewsImpact } from '../../../shared/news';
import { meetsImpact, newsImpacts } from '../../../shared/news';
import { lossBases, resetZones } from '../../../shared/trading-day';
import { accountLabel, automation, automationStore, runBulkTrades } from '../../lib/automation';
import { formatMoney, formatTime } from '../../lib/format';
import { log, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { openDialog } from '../../lib/workspace';
import { EmptyState, NumberField, Section, SelectField, StatusPill, Switch } from '../ui/Controls';

const UPCOMING_NEWS = 6;

const localTime = (time: number) => new Date(time).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

interface NewsScheduleProps {
  impact: NewsImpact;
}

function NewsSchedule({ impact }: NewsScheduleProps) {
  const news = useStore(automationStore, (state) => state.news);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const upcoming = news.events.filter((event) => meetsImpact(event.impact, impact)).slice(0, UPCOMING_NEWS);
  const refresh = () => {
    setIsRefreshing(true);
    void automation.request('news.refresh', {}).then((view) => automationStore.set({ news: view })).catch((error: Error) => log(error.message, 'News')).finally(() => setIsRefreshing(false));
  };
  return (
    <>
      {!news.status.isCovering && (
        <p className="banner is-warn">
          The economic calendar does not cover this week{news.status.error ? ` (${news.status.error})` : ''}, so the news blackout is not enforced.{' '}
          <button type="button" className="link-button" disabled={isRefreshing} onClick={refresh}>Try again</button>
        </p>
      )}
      {upcoming.length ? (
        <table className="grid compact">
          <thead><tr><th>Your time</th><th>Currency</th><th>Event</th><th>Impact</th></tr></thead>
          <tbody>
            {upcoming.map((event) => (
              <tr key={`${event.time}-${event.currency}-${event.title}`}>
                <td>{localTime(event.time)}</td>
                <td>{event.currency}</td>
                <td>{event.title}</td>
                <td>{newsImpacts.find((item) => item.key === event.impact)?.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : news.status.isCovering && <p className="is-muted">No more releases of this impact this week.</p>}
      <p className="is-muted">Calendar from ForexFactory{news.status.fetchedAt ? `, updated ${localTime(news.status.fetchedAt)}` : ''}. Pairs, metals and indices are matched by the currencies the broker lists for them.</p>
    </>
  );
}

interface GuardEditorProps {
  accountId: string;
}

function GuardEditor({ accountId }: GuardEditorProps) {
  const stored = useStore(automationStore, (state) => state.manager.guards.find((guard) => guard.accountId === accountId));
  const status = useStore(automationStore, (state) => state.manager.guardStates.find((item) => item.accountId === accountId));
  const equity = useStore(session, (state) => state.profileId === accountId ? state.account?.equity : undefined);
  const requests = useStore(automationStore, (state) => state.manager.requestCounts.find((item) => item.accountId === accountId));
  const [guard, setGuard] = useState<AccountGuard>(stored ?? defaultGuard(accountId));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setGuard(stored ?? defaultGuard(accountId)), [stored, accountId]);
  const set = (patch: Partial<AccountGuard>) => setGuard({ ...guard, ...patch });
  const optional = (value: number) => (value > 0 ? value : undefined);
  const isDirty = JSON.stringify(stored ?? defaultGuard(accountId)) !== JSON.stringify(guard);
  const requestsToday = requests && requests.dayKey === status?.dayKey ? requests.count : 0;
  const hasNewsWindow = !!(stored?.isEnabled && (stored.newsMinutesBefore || stored.newsMinutesAfter));
  const whole = (value: number) => optional(Math.round(value));
  return (
    <Section
      title="Equity guard"
      detail="Prop-firm style limits. When one trips, new trades from every source (manual, risk ticket, webhooks, copier) are blocked."
      actions={<button type="button" className="is-primary" disabled={!isDirty} onClick={() => automation.request('manager.setGuard', guard).then(() => setMessage('Saved')).catch((error: Error) => setMessage(error.message))}>{isDirty ? 'Save guard' : 'Saved'}</button>}
    >
      {message && <p className="banner is-good">{message}</p>}
      {status?.trippedAt && (
        <p className="banner is-bad">
          Tripped {formatTime(status.trippedAt)}: {status.reason}.{' '}
          <button type="button" className="link-button" onClick={() => void automation.request('manager.resetGuard', { accountId })}>Reset and allow trading</button>
        </p>
      )}
      <div className="status-strip">
        <span>Day start balance <b>{status ? formatMoney(status.dayStartBalance) : '-'}</b></span>
        <span>Day start equity <b>{status ? formatMoney(status.dayStartEquity) : '-'}</b></span>
        <span>Peak equity <b>{status ? formatMoney(status.peakEquity) : '-'}</b></span>
        <span>Equity now <b>{equity !== undefined && Number.isFinite(equity) ? formatMoney(equity) : '-'}</b></span>
        {status?.dayStartedAt && <span>Day recorded from <b>{localTime(status.dayStartedAt)}</b></span>}
        {status && <span>Trade requests today <b>{requestsToday}{guard.maxDailyRequests ? ` / ${guard.maxDailyRequests}` : ''}</b></span>}
      </div>
      <div className="form-grid">
        <Switch label="Guard enabled" isOn={guard.isEnabled} onChange={(isEnabled) => set({ isEnabled })} />
        <SelectField label="When tripped" value={guard.action} options={guardActions} onChange={(action) => set({ action })} />
        <NumberField label="Daily loss (money)" value={guard.dailyLossMoney ?? 0} step={50} hint="Account currency. 0 is off." onChange={(value) => set({ dailyLossMoney: optional(value) })} />
        <NumberField label="Daily loss (percent)" value={guard.dailyLossPercent ?? 0} step={0.5} suffix="%" hint="Of the day's starting value, measured as set below." onChange={(value) => set({ dailyLossPercent: optional(value) })} />
        <NumberField label="Max drawdown" value={guard.maxDrawdownPercent ?? 0} step={0.5} suffix="%" hint="From the equity peak. Needs a manual reset." onChange={(value) => set({ maxDrawdownPercent: optional(value) })} />
        <NumberField label="Daily profit lock" value={guard.dailyProfitMoney ?? 0} step={50} hint="Stop for the day once this profit is reached." onChange={(value) => set({ dailyProfitMoney: optional(value) })} />
        <NumberField label="Max open positions" value={guard.maxOpenPositions ?? 0} onChange={(value) => set({ maxOpenPositions: optional(Math.round(value)) })} />
        <NumberField label="Max lots per symbol" value={guard.maxLotsPerSymbol ?? 0} step={0.1} onChange={(value) => set({ maxLotsPerSymbol: optional(value) })} />
        <SelectField label="Day resets on" value={guard.resetZone} options={resetZones} hint="Use the clock your firm's rules name. Most reset at broker server midnight." onChange={(resetZone) => set({ resetZone })} />
        <NumberField label="Day starts at" value={guard.resetHour} min={0} max={23} suffix=":00" hint="In the clock chosen above." onChange={(resetHour) => set({ resetHour: Math.min(23, Math.max(0, Math.round(resetHour))) })} />
        <SelectField label="Daily loss measured from" value={guard.lossBasis} options={lossBases} hint={lossBases.find((item) => item.key === guard.lossBasis)?.hint} onChange={(lossBasis) => set({ lossBasis })} />
        <NumberField label="Max trade requests a day" value={guard.maxDailyRequests ?? 0} step={100} hint="Every order, change, close and delete counts. Closes and deletes still go through past the limit. 0 is off." onChange={(value) => set({ maxDailyRequests: whole(value) })} />
        <NumberField label="No new trades before news" value={guard.newsMinutesBefore ?? 0} max={240} suffix="min" hint="0 with 0 after turns the blackout off." onChange={(value) => set({ newsMinutesBefore: whole(value) })} />
        <NumberField label="No new trades after news" value={guard.newsMinutesAfter ?? 0} max={240} suffix="min" onChange={(value) => set({ newsMinutesAfter: whole(value) })} />
        <SelectField label="News impact" value={guard.newsImpact} options={newsImpacts.map((item) => ({ key: item.key, label: item.key === 'high' ? 'High only' : `${item.label} and above` }))} onChange={(newsImpact) => set({ newsImpact })} />
      </div>
      <p className="is-muted">The day's starting values are recorded from the first update after the reset. If OpenTerm5 was closed at the reset, losses taken before it opened are not counted, so open it before the day starts.</p>
      {hasNewsWindow && <NewsSchedule impact={stored!.newsImpact} />}
    </Section>
  );
}

interface BulkActionsProps {
  accountId: string;
}

function BulkActions({ accountId }: BulkActionsProps) {
  const [symbol, setSymbol] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const run = (kind: BulkKind, label: string) => {
    if (!window.confirm(`${label}${kind === 'closeSymbol' ? ` ${symbol}` : ''} on ${accountLabel(accountId)}?`)) return;
    runBulkTrades(`${label}${kind === 'closeSymbol' ? ` ${symbol}` : ''}`, { kind, accountId, ...(kind === 'closeSymbol' ? { symbol } : {}) })
      .then((outcomes) => setResult(`${label}: ${outcomes.filter((outcome) => outcome.result.isSuccess).length} of ${outcomes.length} succeeded${outcomes.some((outcome) => !outcome.result.isSuccess) ? ` (${outcomes.find((outcome) => !outcome.result.isSuccess)!.result.comment})` : ''}`))
      .catch((error: Error) => setResult(error.message));
  };
  return (
    <Section title="One-click actions" detail="Run against the selected account. Each trade is sent separately and reported.">
      {result && <p className="banner is-good">{result}</p>}
      <div className="button-grid">
        {bulkKinds.filter((kind) => kind.key !== 'reverse' && kind.key !== 'closeSymbol').map((kind) => (
          <button key={kind.key} type="button" className={kind.key.startsWith('close') ? 'is-danger' : ''} onClick={() => run(kind.key, kind.label)}>{kind.label}</button>
        ))}
        <span className="inline-form">
          <input aria-label="Symbol to close" placeholder="Symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.trim())} />
          <button type="button" className="is-danger" disabled={!symbol} onClick={() => run('closeSymbol', 'Close positions on')}>Close symbol</button>
        </span>
      </div>
    </Section>
  );
}

interface RuleSummaryProps {
  rule: PositionRule;
}

function RuleSummary({ rule }: RuleSummaryProps) {
  const parts = [
    rule.breakEven && `BE at ${rule.breakEven.triggerPoints} pts${rule.breakEven.isDone ? ' (done)' : ''}`,
    rule.trailing && `trail ${rule.trailing.distancePoints} pts from +${rule.trailing.startPoints}`,
    rule.partials.length && `partials ${rule.partials.map((partial) => `${partial.percent}%@${partial.points}${partial.isDone ? '✓' : ''}`).join(', ')}`,
    rule.virtualStop && `hidden SL ${rule.virtualStop}`,
    rule.virtualTarget && `hidden TP ${rule.virtualTarget}`,
    rule.closeAt && `exit ${formatTime(rule.closeAt, false)}`,
  ].filter(Boolean);
  return <span>{parts.join(' · ') || 'No actions'}</span>;
}

export function AutomationPage() {
  const accounts = useStore(session, (state) => state.accounts);
  const activeId = useStore(session, (state) => state.profileId);
  const rules = useStore(automationStore, (state) => state.manager.rules);
  const [accountId, setAccountId] = useState(activeId ?? accounts[0]?.id ?? '');
  useEffect(() => { if (!accountId && activeId) setAccountId(activeId); }, [activeId, accountId]);
  if (!accounts.length) return <EmptyState title="No accounts yet" detail="Log in to an account (File > Login to Trade Account) to set up guards and trade management." />;
  const accountRules = rules.filter((rule) => rule.accountId === accountId);
  return (
    <div className="page-scroll single">
      <div className="section-header-row">
        <h2>Automation</h2>
        <select aria-label="Account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {accounts.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}{profile.id === activeId ? ' (active)' : ''}</option>)}
        </select>
      </div>
      <p className="banner is-warn">Trade management, guards and hidden stops run inside OpenTerm5. They act only while the app is open and connected, so keep a broker-side stop on every position you cannot watch.</p>
      <GuardEditor key={accountId} accountId={accountId} />
      <BulkActions accountId={accountId} />
      <Section title="Managed positions" detail="Break-even, trailing stops, partial take-profits, hidden stops and time exits. Add them from a position's context menu (Manage…) or from the risk ticket.">
        {accountRules.length ? (
          <table className="grid compact">
            <thead><tr><th className="num">Ticket</th><th>Symbol</th><th>Side</th><th>Management</th><th>Status</th><th /></tr></thead>
            <tbody>
              {accountRules.map((rule) => (
                <tr key={rule.ticket}>
                  <td className="num">{rule.ticket}</td>
                  <td>{rule.symbol}</td>
                  <td className={`side-${rule.side}`}>{rule.side}</td>
                  <td><RuleSummary rule={rule} /></td>
                  <td>{rule.isPaused ? <StatusPill status="paused" label={rule.error ?? 'paused'} /> : <StatusPill status="running" label="Active" />}</td>
                  <td>
                    {accountId === activeId && <button type="button" className="link-button" onClick={() => openDialog({ kind: 'manage', ticket: rule.ticket })}>Edit</button>}{' '}
                    <button type="button" className="link-button" onClick={() => automation.request('manager.removeRule', { accountId, ticket: rule.ticket }).catch((error: Error) => log(error.message, 'Automation'))}>Stop managing</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="is-muted">No managed positions on this account.</p>}
      </Section>
    </div>
  );
}
