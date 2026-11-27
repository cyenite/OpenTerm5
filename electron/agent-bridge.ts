import type { AgentToolCall, AgentToolReply } from '../shared/agent';

const CALL_TIMEOUT_MS = 30_000;

export interface AgentBridgeDeps {
  // False when there is no window to ask.
  readonly send: (id: number, call: AgentToolCall) => boolean;
  readonly timeoutMs?: number;
}

interface Waiting {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly reject: (error: Error) => void;
  readonly resolve: (result: unknown) => void;
}

// Chart tools run in the main window, where the chart engines and the workspace live; this sends
// each call there and waits for its answer.
export class AgentBridge {
  private next = 1;
  private isReady = false;
  private readonly waiting = new Map<number, Waiting>();

  constructor(private readonly deps: AgentBridgeDeps) {}

  // A reload or a closed window fails whatever was still being answered.
  setReady(isReady: boolean): void {
    this.isReady = isReady;
    if (isReady) return;
    for (const id of [...this.waiting.keys()]) this.settle(id, { error: 'The OpenTerm5 window closed or reloaded before it answered.' });
  }

  call(call: AgentToolCall): Promise<unknown> {
    if (!this.isReady) return Promise.reject(new Error('The OpenTerm5 window is not open yet.'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, { error: `${call.name} did not answer in time.` }), this.deps.timeoutMs ?? CALL_TIMEOUT_MS);
      this.waiting.set(id, { timer, reject, resolve });
      if (!this.deps.send(id, call)) this.settle(id, { error: 'The OpenTerm5 window is not open.' });
    });
  }

  receive(id: number, reply: unknown): void {
    const answer = reply as { result?: unknown; error?: unknown } | null;
    if (answer === null || typeof answer !== 'object') this.settle(id, { error: 'The app window sent a malformed answer.' });
    else if ('error' in answer) this.settle(id, { error: String(answer.error) });
    else this.settle(id, { result: answer.result });
  }

  private settle(id: number, reply: AgentToolReply): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    if ('error' in reply) waiting.reject(new Error(reply.error));
    else waiting.resolve(reply.result);
  }
}
