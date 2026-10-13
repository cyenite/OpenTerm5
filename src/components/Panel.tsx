import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Panel({ title, children, onClose }: PanelProps) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-header">
        <span>{title}</span>
        {onClose && (
          <button className="panel-close" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        )}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
