import { useEffect, useRef, useState } from 'react';
import { layoutGroups, layoutSyncs } from '../../lib/chart-layouts';
import { hasSync } from '../../lib/chart-tabs';
import { useStore } from '../../lib/store';
import { activeTab, setTabLayout, toggleLayoutSync, workspace } from '../../lib/workspace';
import { Switch } from '../ui/Controls';
import { hintProps } from '../ui/Hint';
import { LayoutIcon } from './LayoutIcon';

// The chart bar's layout button: TradingView's layout setup, with every layout grouped by how many
// charts it holds, then the active tab's sync switches. Switches leave the panel open; a layout
// choice closes it.
export function LayoutPicker() {
  const tab = useStore(workspace, activeTab);
  const [isOpen, setIsOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      anchor.current?.focus();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const box = anchor.current?.getBoundingClientRect();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`tool-button${isOpen ? ' is-active' : ''}`}
        aria-label="Layout Setup"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-disabled={!tab || undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => tab && setIsOpen(!isOpen)}
        {...hintProps({ title: 'Layout Setup', description: 'Show several charts in this tab and choose what they keep in sync.' })}
      >
        <LayoutIcon layout={tab?.layout ?? 's'} />
      </button>
      {isOpen && tab && box && (
        <div className="layout-picker" role="dialog" aria-label="Layout setup" style={{ left: box.left, top: box.bottom + 4 }} onMouseDown={(event) => event.stopPropagation()}>
          <div className="layout-picker-grid">
            {layoutGroups().map((group) => (
              <div key={group.count} className="layout-picker-row" role="radiogroup" aria-label={`${group.count} chart${group.count === 1 ? '' : 's'}`}>
                <span className="layout-picker-count">{group.count}</span>
                {group.layouts.map((layout) => (
                  <button
                    key={layout.key}
                    type="button"
                    role="radio"
                    aria-checked={layout.key === tab.layout}
                    className={`layout-picker-option${layout.key === tab.layout ? ' is-active' : ''}`}
                    title={layout.label}
                    aria-label={layout.label}
                    onClick={() => { setTabLayout(tab.id, layout.key); setIsOpen(false); }}
                  >
                    <LayoutIcon layout={layout.key} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="layout-picker-syncs">
            <h3>Sync in layout</h3>
            {layoutSyncs.map((sync) => <Switch key={sync.key} label={sync.label} hint={sync.description} isOn={hasSync(tab, sync.key)} onChange={() => toggleLayoutSync(tab.id, sync.key)} />)}
          </div>
        </div>
      )}
    </>
  );
}
