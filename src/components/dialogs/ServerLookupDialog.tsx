import { Component } from 'react';
import type { ServerLookupResult } from '../../../shared/protocol';
import { terminal } from '../../lib/session';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface ServerLookupState {
  query: string;
  webUrl: string;
  error: string;
  known: ServerLookupResult[];
  found: ServerLookupResult[];
  isBusy: boolean;
}

export class ServerLookupDialog extends Component<Record<string, never>, ServerLookupState> {
  state: ServerLookupState = {
    query: '',
    webUrl: 'https://web.metatrader.app/terminal',
    error: '',
    known: [],
    found: [],
    isBusy: false,
  };

  private isMounted = false;

  componentDidMount() {
    this.isMounted = true;
    void terminal.request('accounts.list', {}).then((profiles) => {
      if (!this.isMounted) return;
      this.setState({ known: profiles.map((profile) => ({
        broker: profile.company || profile.label,
        server: profile.server,
        type: profile.tradeMode,
        webUrl: '',
        webEndpoint: profile.webEndpoint,
        isWebAvailable: true,
      })) });
    }).catch((reason: unknown) => {
      if (this.isMounted) this.setState({ error: reason instanceof Error ? reason.message : 'Saved servers could not be loaded.' });
    });
    void this.search();
  }

  componentWillUnmount() {
    this.isMounted = false;
  }

  private search = async () => {
    this.setState({ error: '', isBusy: true });
    try {
      const found = await terminal.request('servers.lookup', { webUrl: this.state.webUrl });
      if (this.isMounted) this.setState({ found });
    } catch (reason) {
      if (this.isMounted) this.setState({ error: reason instanceof Error ? reason.message : 'Server lookup failed.' });
    } finally {
      if (this.isMounted) this.setState({ isBusy: false });
    }
  };

  private connect = async (server: ServerLookupResult) => {
    this.setState({ error: '', isBusy: true });
    try {
      await terminal.saveSettings({ webEndpoint: server.webEndpoint });
      closeDialog();
    } catch (reason) {
      if (this.isMounted) this.setState({ error: reason instanceof Error ? reason.message : 'The web endpoint could not be applied.', isBusy: false });
    }
  };

  render() {
    const { query, webUrl, error, known, found, isBusy } = this.state;
    const entries = new Map<string, ServerLookupResult>();
    const search = query.trim().toLowerCase();
    for (const server of [...known, ...found]) {
      if (search && !`${server.broker} ${server.server} ${server.type}`.toLowerCase().includes(search)) continue;
      entries.set(`${server.webEndpoint}\n${server.server}`, server);
    }
    return (
      <Dialog title="Find broker / server" width={620}>
        <div className="order-form">
          <label className="field">
            <span>Broker web terminal</span>
            <input value={webUrl} disabled={isBusy} onChange={(event) => this.setState({ webUrl: event.target.value })} placeholder="https://your-broker.example/terminal" />
          </label>
          <button disabled={isBusy} onClick={this.search}>{isBusy ? 'Looking up…' : 'Look up web servers'}</button>
          <label className="field">
            <span>Find in results</span>
            <input value={query} onChange={(event) => this.setState({ query: event.target.value })} placeholder="Broker or server name" />
          </label>
          <p className="is-muted">Results include saved account servers and servers published by this broker’s web terminal. Desktop server names alone cannot select a web endpoint. Use your broker’s web-terminal URL to discover its web servers.</p>
          {error && <p role="alert" className="is-loss">{error}</p>}
          <div className="symbols-list">
            {[...entries.values()].map((server) => (
              <div className="symbol-option" key={`${server.webEndpoint}:${server.server}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{server.server || server.broker}</b>
                  <div className="is-muted">{server.broker} · {server.type}</div>
                  <div style={{ overflowWrap: 'anywhere' }}>{server.webEndpoint}</div>
                  <small className="is-muted">{server.webUrl ? 'Web terminal metadata found; account login still required.' : 'Endpoint from a saved account.'}</small>
                </div>
                <button disabled={isBusy || !server.isWebAvailable} onClick={() => this.connect(server)}>Use endpoint</button>
              </div>
            ))}
            {!isBusy && entries.size === 0 && <p>No matching web servers. Check the broker’s web-terminal URL.</p>}
          </div>
          <div className="dialog-actions"><button onClick={closeDialog}>Close</button></div>
        </div>
      </Dialog>
    );
  }
}
