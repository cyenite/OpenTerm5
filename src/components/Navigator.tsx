import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { MenuItem } from './MenuBar';
import { connectProfile, removeProfile } from '../lib/accounts';
import { togglePanel } from '../lib/commands';
import { openContextMenu } from '../lib/context-menu';
import { indicatorKinds } from '../lib/indicators';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { activeChart, openDialog, workspace } from '../lib/workspace';
import { Panel } from './Panel';

interface TreeNodeProps {
  label: string;
  icon: string;
  detail?: string;
  title?: string;
  isEmphasized?: boolean;
  children?: ReactNode;
  onOpen?: () => void;
  menu?: () => MenuItem[];
}

// Leaves act on a single click, like a desktop sidebar; branches expand on click.
function TreeNode({ label, icon, detail, title, isEmphasized, children, onOpen, menu }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = children !== undefined;
  const activate = () => hasChildren ? setIsExpanded(!isExpanded) : onOpen?.();
  return (
    <li className="tree-node">
      <div
        className={`tree-label${isEmphasized ? ' is-emphasized' : ''}${onOpen || hasChildren ? ' is-actionable' : ''}`}
        title={title}
        role="treeitem"
        tabIndex={0}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={activate}
        onKeyDown={(event) => event.key === 'Enter' && activate()}
        onContextMenu={(event: ReactMouseEvent) => menu && openContextMenu(event, menu())}
      >
        <span className="tree-toggle">{hasChildren ? (isExpanded ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{icon}</span>
        <span className="tree-text">{label}</span>
        {detail && <span className="tree-detail">{detail}</span>}
      </div>
      {hasChildren && isExpanded && <ul className="tree" role="group">{children}</ul>}
    </li>
  );
}

export function Navigator() {
  const accounts = useStore(session, (state) => state.accounts);
  const profileId = useStore(session, (state) => state.profileId);
  const status = useStore(session, (state) => state.status);
  const chartId = useStore(workspace, (state) => activeChart(state)?.id);
  const attach = (indicator: (typeof indicatorKinds)[number]['key']) => chartId && openDialog({ kind: 'indicator', chartId, indicator });

  return (
    <Panel title="Navigator" onClose={() => togglePanel('isNavigatorShown')}>
      <div className="scroll">
        <ul className="tree" role="tree">
          <TreeNode label={status?.company || 'Terminal5'} icon="◈">
            <TreeNode label="Accounts" icon="👤" menu={() => [{ label: 'Login to Trade Account...', action: () => openDialog({ kind: 'login' }) }, { label: 'Manage Accounts...', action: () => openDialog({ kind: 'accounts' }) }]}>
              {accounts.map((profile) => {
                const isActive = profileId === profile.id;
                return (
                  <TreeNode
                    key={profile.id}
                    label={profile.label || String(profile.login)}
                    detail={isActive ? 'active' : profile.tradeMode}
                    icon={isActive ? '●' : '○'}
                    isEmphasized={isActive}
                    title={`${profile.login} · ${profile.server}${profile.company ? ` · ${profile.company}` : ''}`}
                    onOpen={() => { if (!isActive) void connectProfile(profile); }}
                    menu={() => [
                      { label: 'Login', isDisabled: isActive, action: () => void connectProfile(profile) },
                      { label: 'Edit Login...', action: () => openDialog({ kind: 'login', profileId: profile.id }) },
                      { label: '', isSeparator: true },
                      { label: 'Remove', action: () => void removeProfile(profile) },
                    ]}
                  />
                );
              })}
              <TreeNode label="Login to trade account" icon="+" onOpen={() => openDialog({ kind: 'login' })} />
              <TreeNode label="Manage accounts" icon="⋯" onOpen={() => openDialog({ kind: 'accounts' })} />
            </TreeNode>
            <TreeNode label="Indicators" icon="ƒ">
              {indicatorKinds.map((kind) => (
                <TreeNode
                  key={kind.key}
                  label={kind.label}
                  icon="ƒ"
                  title="Click to attach to the active chart"
                  onOpen={() => attach(kind.key)}
                  menu={() => [{ label: 'Attach to Chart', isDisabled: !chartId, action: () => attach(kind.key) }]}
                />
              ))}
            </TreeNode>
          </TreeNode>
        </ul>
      </div>
    </Panel>
  );
}
