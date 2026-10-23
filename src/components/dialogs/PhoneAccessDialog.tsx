import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { hubScopes, type HubDeviceView, type HubPairingOffer, type HubScope } from '../../../shared/hub';
import { hubStore, requestHub } from '../../lib/hub';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { NumberField, Segmented, SelectField, StatusPill, Switch } from '../ui/Controls';
import { Dialog } from './Dialog';

const seen = (device: HubDeviceView) => device.isConnected ? `Connected from ${device.address ?? 'the network'}` : device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : 'Not connected yet';

interface PairingCodeProps {
  offer: HubPairingOffer;
}

function PairingCode({ offer }: PairingCodeProps) {
  const [now, setNow] = useState(Date.now());
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const code = qrcode(0, 'M');
  code.addData(offer.url);
  code.make();
  const image = `data:image/svg+xml;utf8,${encodeURIComponent(code.createSvgTag({ cellSize: 4, margin: 4, scalable: true }))}`;
  const seconds = Math.max(0, Math.round((offer.expiresAt - now) / 1000));
  const copy = () => void navigator.clipboard.writeText(offer.url).then(() => setIsCopied(true)).catch(() => undefined);
  return (
    <div className="pairing-code">
      <img src={image} alt="Pairing code for a phone" width={196} height={196} />
      <div>
        <p>Scan this with the phone's camera and open the link. The phone must be on the same network as this computer.</p>
        <p className="is-muted">The code works once, for {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} more. It lets the phone {offer.scope === 'trade' ? 'view charts and trade' : 'view charts, but not trade'}.</p>
        <button type="button" onClick={copy}>{isCopied ? 'Link copied' : 'Copy link'}</button>
      </div>
    </div>
  );
}

interface DeviceRowProps {
  device: HubDeviceView;
}

function DeviceRow({ device }: DeviceRowProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <tr>
      <td><b>{device.name}</b><br /><span className="is-muted">Paired {new Date(device.pairedAt).toLocaleDateString()}</span></td>
      <td><StatusPill status={device.isConnected ? 'connected' : 'idle'} label={device.isConnected ? 'Connected' : 'Offline'} /><br /><span className="is-muted">{seen(device)}</span></td>
      <td><SelectField label="Access" value={device.scope} options={hubScopes} onChange={(scope) => void requestHub('hub.setScope', { id: device.id, scope })} /></td>
      <td>{isConfirming
        ? <><button type="button" onClick={() => void requestHub('hub.revoke', { id: device.id })}>Confirm unpair</button> <button type="button" onClick={() => setIsConfirming(false)}>Keep</button></>
        : <button type="button" onClick={() => setIsConfirming(true)}>Unpair</button>}</td>
    </tr>
  );
}

export function PhoneAccessDialog() {
  const view = useStore(hubStore, (state) => state.view);
  const [port, setPort] = useState(view?.settings.port ?? 8788);
  const [scope, setScope] = useState<HubScope>('view');
  const [error, setError] = useState('');
  useEffect(() => { void requestHub('hub.view', {}).then((next) => next && hubStore.set({ view: next })); }, []);
  if (!view) return <Dialog title="Phone Access" width={640}><p className="is-muted">Loading…</p></Dialog>;
  const save = async (isEnabled: boolean, nextPort = view.settings.port) => {
    setError('');
    const next = await requestHub('hub.save', { port: nextPort, isEnabled });
    if (!next) setError('The setting could not be saved. The Journal has the reason.');
  };
  const pair = async () => {
    setError('');
    if (!await requestHub('hub.pair', { scope })) setError('No pairing code could be made. The Journal has the reason.');
  };
  return (
    <Dialog title="Phone Access" width={680}>
      <p className="is-muted">A paired phone uses this computer's accounts: no second login at your broker, and your guards check every order it sends. OpenTerm5 must stay open on this computer.</p>
      <Switch label="Allow paired phones to connect" hint={view.isRunning ? `Listening on ${view.addresses.join(', ') || `port ${view.settings.port}`}` : 'Off: no phone can connect.'} isOn={view.settings.isEnabled} onChange={(isOn) => void save(isOn)} />
      <div className="hub-port">
        <NumberField label="Port" value={port} min={1024} max={65535} onChange={setPort} />
        <button type="button" disabled={port === view.settings.port} onClick={() => void save(view.settings.isEnabled, port)}>Use port</button>
      </div>
      {view.error && <p className="is-loss" role="alert">{view.error}</p>}
      {!view.isPersistent && <p className="banner is-warn">This computer has no secure credential storage, so pairings last only until OpenTerm5 quits.</p>}
      <h3>Pair a phone</h3>
      {view.offer
        ? <><PairingCode offer={view.offer} /><div className="dialog-actions"><button type="button" onClick={() => void requestHub('hub.cancelPairing', {})}>Cancel code</button></div></>
        : <div className="pairing-start">
          <Segmented label="What the phone may do" value={scope} options={hubScopes} onChange={setScope} />
          <p className="is-muted">{hubScopes.find((item) => item.key === scope)?.description}</p>
          <button type="button" className="is-primary" aria-disabled={!view.isRunning} title={view.isRunning ? undefined : 'Turn on phone access first'} onClick={() => view.isRunning && void pair()}>Show pairing code</button>
        </div>}
      <h3>Paired phones</h3>
      {view.devices.length
        ? <table className="grid"><thead><tr><th>Phone</th><th>Status</th><th>Access</th><th /></tr></thead><tbody>{view.devices.map((device) => <DeviceRow key={device.id} device={device} />)}</tbody></table>
        : <p className="is-muted">No phones are paired.</p>}
      {error && <p className="is-loss" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={closeDialog}>Close</button></div>
    </Dialog>
  );
}
