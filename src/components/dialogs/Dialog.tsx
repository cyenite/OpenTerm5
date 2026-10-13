import { useEffect, type ReactNode } from 'react';
import { closeDialog } from '../../lib/workspace';

interface DialogProps {
  title: string;
  width?: number;
  children: ReactNode;
}

export function Dialog({ title, width = 420, children }: DialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeDialog();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <header className="dialog-title">
          <span>{title}</span>
          <button className="panel-close" onClick={closeDialog} aria-label="Close">×</button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
