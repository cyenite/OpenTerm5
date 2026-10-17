import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { MenuItem } from './MenuBar';
import { connectProfile, removeProfile } from '../lib/accounts';
import { togglePanel } from '../lib/commands';
import { openContextMenu } from '../lib/context-menu';
import { indicatorFavorites } from '../lib/indicator-favorites';
import { entryLabel } from '../lib/indicator-catalog';
import { favoriteIndicators } from '../lib/indicator-menu';
import { pineScripts } from '../lib/pine/pine-scripts';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { activeChart, addIndicator, openDialog, workspace } from '../lib/workspace';
import { Panel } from './Panel';

interface TreeNodeProps {
  label: string;
  icon: ReactNode;
  detail?: string;
  title?: string;
  isEmphasized?: boolean;
  isInitiallyCollapsed?: boolean;
  children?: ReactNode;
  onOpen?: () => void;
  menu?: () => MenuItem[];
}

// Leaves act on a single click, like a desktop sidebar; branches expand on click.
function TreeNode({ label, icon, detail, title, isEmphasized, isInitiallyCollapsed, children, onOpen, menu }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(!isInitiallyCollapsed);
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
  const signIn = useStore(session, (state) => state.signIn);
  const profileId = useStore(session, (state) => state.profileId);
  const status = useStore(session, (state) => state.status);
  const isSigningIn = signIn?.state === 'signing-in';
  const chartId = useStore(workspace, (state) => activeChart(state)?.id);
  const attach = (kind: string) => chartId && addIndicator(chartId, kind);
  // Favourites are read from the stores below; these re-render the tree when they change.
  useStore(pineScripts, (state) => state.scripts);
  useStore(indicatorFavorites, (state) => state.types);

  return (
    <Panel title="Navigator" onClose={() => togglePanel('isNavigatorShown')}>
      <div className="scroll">
        <ul className="tree" role="tree">
          <TreeNode label={status?.company || 'OpenTerm5'} icon="◈">
            <TreeNode label="Accounts" icon="👤" menu={() => [{ label: 'Login to Trade Account...', action: () => openDialog({ kind: 'login' }) }, { label: 'Manage Accounts...', action: () => openDialog({ kind: 'accounts' }) }]}>
              {accounts.map((profile) => {
                const isActive = profileId === profile.id;
                const isTarget = signIn?.id === profile.id;
                const hasFailed = isTarget && signIn.state === 'failed';
                const isPending = isTarget && isSigningIn;
                const summary = `${profile.login} · ${profile.server}${profile.company ? ` · ${profile.company}` : ''}`;
                return (
                  <TreeNode
                    key={profile.id}
                    label={profile.label || String(profile.login)}
                    detail={isPending ? 'signing in' : hasFailed ? 'failed' : isActive ? 'active' : profile.tradeMode}
                    icon={isPending ? <span className="spinner" aria-hidden /> : isActive ? '●' : '○'}
                    isEmphasized={isActive || isPending}
                    title={hasFailed ? `${summary} · Sign-in failed: ${signIn.error ?? 'unknown error'}` : isSigningIn && !isPending ? `${summary} · Available once the current sign-in finishes` : summary}
                    onOpen={() => { if (!isActive && !isSigningIn) void connectProfile(profile); }}
                    menu={() => [
                      { label: isPending ? 'Signing in…' : 'Login', isDisabled: isActive || isSigningIn, action: () => void connectProfile(profile) },
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
              <TreeNode label="Favorites" icon="★">
                {favoriteIndicators().map((entry) => (
                  <TreeNode
                    key={entry.type}
                    label={entryLabel(entry)}
                    icon="ƒ"
                    title="Click to attach to the active chart"
                    onOpen={() => attach(entry.type)}
                    menu={() => [{ label: 'Attach to Chart', isDisabled: !chartId, action: () => attach(entry.type) }]}
                  />
                ))}
              </TreeNode>
              <TreeNode label="All indicators" icon="⋯" title="Open the Indicators dialog" onOpen={() => openDialog({ kind: 'indicators' })} />
            </TreeNode>
          </TreeNode>
        </ul>
      </div>
    </Panel>
  );
}
