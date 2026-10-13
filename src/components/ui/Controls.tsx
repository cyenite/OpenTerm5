import type { ReactNode } from 'react';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.key} role="radio" aria-checked={option.key === value} className={option.key === value ? 'is-active' : ''} onClick={() => onChange(option.key)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SwitchProps {
  label: string;
  hint?: string;
  isOn: boolean;
  isDisabled?: boolean;
  onChange: (isOn: boolean) => void;
}

export function Switch({ label, hint, isOn, isDisabled, onChange }: SwitchProps) {
  return (
    <label className={`switch-row${isDisabled ? ' is-disabled' : ''}`}>
      <span className="switch-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={isOn} aria-label={label} disabled={isDisabled} className={`switch${isOn ? ' is-on' : ''}`} onClick={() => onChange(!isOn)}>
        <span className="switch-knob" />
      </button>
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

export function NumberField({ label, value, hint, step = 1, min = 0, max, suffix, onChange }: NumberFieldProps) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <span className="input-with-suffix">
        <input type="number" value={Number.isFinite(value) ? value : ''} step={step} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <em>{suffix}</em>}
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  isMonospace?: boolean;
  isSecret?: boolean;
  onChange: (value: string) => void;
}

export function TextField({ label, value, hint, placeholder, isMonospace, isSecret, onChange }: TextFieldProps) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input className={isMonospace ? 'is-mono' : ''} type={isSecret ? 'password' : 'text'} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  hint?: string;
  options: readonly { key: T; label: string }[];
  onChange: (value: T) => void;
}

export function SelectField<T extends string>({ label, value, hint, options, onChange }: SelectFieldProps<T>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      {hint && <small>{hint}</small>}
    </label>
  );
}

interface SectionProps {
  title: string;
  detail?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Section({ title, detail, actions, children }: SectionProps) {
  return (
    <section className="card">
      <header className="card-header">
        <div>
          <h3>{title}</h3>
          {detail && <p>{detail}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

const pillTones: Record<string, string> = {
  ok: 'good', executed: 'good', connected: 'good', open: 'good', enabled: 'good', running: 'good',
  skipped: 'neutral', dryRun: 'neutral', duplicate: 'neutral', idle: 'neutral', closed: 'neutral', accepted: 'neutral', monitorExisting: 'warn',
  retrying: 'warn', connecting: 'warn', opening: 'warn', unknown: 'warn', paused: 'warn',
  failed: 'bad', rejected: 'bad', disabled: 'bad', tripped: 'bad',
};

interface StatusPillProps {
  status: string;
  label?: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  return <span className={`pill is-${pillTones[status] ?? 'neutral'}`}>{label ?? status}</span>;
}

interface EmptyStateProps {
  title: string;
  detail: string;
  action?: ReactNode;
}

export function EmptyState({ title, detail, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}
