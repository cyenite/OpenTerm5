import { iconSvg } from './icons';
import { element } from './styles';

export interface ReplayActions {
  togglePlay: () => void;
  step: () => void;
  restart: () => void;
  setSpeed: (barsPerSecond: number) => void;
  exit: () => void;
}

export const replaySpeeds = [0.5, 1, 3, 10, 30] as const;

// The bar replay controls: play or pause, step one bar, pick a new start, speed and exit.
export class ReplayBar {
  private readonly bar: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly status: HTMLElement;

  constructor(host: HTMLElement, actions: ReplayActions) {
    this.bar = element('div', 'mc-replay', host);
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Bar replay');
    this.bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.hint = element('div', 'mc-replay-hint', host);
    this.hint.textContent = 'Click a bar to start the replay from it';
    const button = (icon: string, label: string, action: () => void) => {
      const node = element('button', 'mc-btn', this.bar);
      node.type = 'button';
      node.title = label;
      node.setAttribute('aria-label', label);
      node.innerHTML = iconSvg(icon, 24);
      node.onclick = action;
      return node;
    };
    button('replay', 'Select a new start bar', actions.restart);
    this.playButton = button('play', 'Play', actions.togglePlay);
    button('step-forward', 'Forward one bar', actions.step);
    const speed = element('select', undefined, this.bar);
    speed.setAttribute('aria-label', 'Replay speed');
    for (const value of replaySpeeds) {
      const option = element('option', undefined, speed);
      option.value = String(value);
      option.textContent = `${value}×`;
    }
    speed.value = '1';
    speed.onchange = () => actions.setSpeed(Number(speed.value));
    this.status = element('span', 'mc-replay-status', this.bar);
    button('stop', 'Exit replay', actions.exit);
    this.hide();
  }

  destroy(): void {
    this.bar.remove();
    this.hint.remove();
  }

  show(state: { isSelecting: boolean; isPlaying: boolean; status: string }): void {
    this.bar.style.display = '';
    this.hint.style.display = state.isSelecting ? '' : 'none';
    this.playButton.innerHTML = iconSvg(state.isPlaying ? 'pause' : 'play', 24);
    this.playButton.title = state.isPlaying ? 'Pause' : 'Play';
    this.playButton.setAttribute('aria-label', this.playButton.title);
    this.playButton.disabled = state.isSelecting;
    this.status.textContent = state.status;
  }

  hide(): void {
    this.bar.style.display = 'none';
    this.hint.style.display = 'none';
  }
}
