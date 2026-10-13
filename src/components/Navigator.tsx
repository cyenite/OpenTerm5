import { useState, type ReactNode } from 'react';
import { togglePanel } from '../lib/commands';
import { indicatorKinds } from '../lib/indicators';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { activeChart, openDialog, workspace } from '../lib/workspace';
import { Panel } from './Panel';

interface TreeNodeProps {
  label: string;
  icon: string;
  title?: string;
  children?: ReactNode;
  onOpen?: () => void;
}

function TreeNode({ label, icon, title, children, onOpen }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = children !== undefined;
  return (
    <li className="tree-node">
      <div
        className="tree-label"
        title={title}
        onDoubleClick={onOpen}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        <span className="tree-toggle">{hasChildren ? (isExpanded ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{icon}</span>
        {label}
      </div>
      {hasChildren && isExpanded && <ul className="tree">{children}</ul>}
    </li>
  );
}

export function Navigator() {
  const accounts = useStore(session, (state) => state.accounts);
  const profileId = useStore(session, (state) => state.profileId);
  const status = useStore(session, (state) => state.status);
  const chartId = useStore(workspace, (state) => activeChart(state)?.id);

  return (
    <Panel title="Navigator" onClose={() => togglePanel('isNavigatorShown')}>
      <div className="scroll">
        <ul className="tree">
          <TreeNode label={status?.company ?? 'Terminal5 · MT5 Web'} icon="◈">
            <TreeNode label="Accounts" icon="👤">
              {accounts.map((profile) => <TreeNode key={profile.id} label={`${profile.label} · ${profile.server}${profileId === profile.id ? ' · Active' : ''}`} icon={profile.tradeMode === 'real' ? '●' : '○'} title={profile.webEndpoint} onOpen={() => openDialog({ kind: 'login', profileId: profile.id })} />)}
              <TreeNode label="Manage trading accounts" icon="+" onOpen={() => openDialog({ kind: 'accounts' })} />
            </TreeNode>
            <TreeNode label="Indicators" icon="ƒ">
              {indicatorKinds.map((kind) => (
                <TreeNode
                  key={kind.key}
                  label={kind.label}
                  icon="ƒ"
                  title="Double-click to attach to the active chart"
                  onOpen={() => chartId && openDialog({ kind: 'indicator', chartId, indicator: kind.key })}
                />
              ))}
            </TreeNode>
          </TreeNode>
        </ul>
      </div>
    </Panel>
  );
}
