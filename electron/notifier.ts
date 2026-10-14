import type { NotificationEvent, NotificationTarget } from '../shared/automation';

const TIMEOUT_MS = 5_000;
const MAX_PER_MINUTE = 20;

export function validateTarget(target: NotificationTarget): string | null {
  if (!target.name.trim()) return 'Name the notification target';
  if (target.kind === 'telegram') {
    if (!/^\d+:[\w-]{20,}$/.test(target.url)) return 'Telegram needs the bot token from @BotFather (digits:letters)';
    if (!/^-?\d+$|^@\w+$/.test(target.chatId)) return 'Telegram needs a numeric chat id or @channel';
    return null;
  }
  try {
    const url = new URL(target.url);
    if (url.protocol !== 'https:') return 'Notification URLs must use https';
  } catch { return 'Enter a valid https URL'; }
  return null;
}

export function notificationRequest(target: NotificationTarget, event: NotificationEvent, title: string, message: string, time: number): { url: string; body: unknown } {
  const text = `${title}\n${message}`;
  switch (target.kind) {
    case 'discord': return { url: target.url, body: { content: text.slice(0, 1900), allowed_mentions: { parse: [] } } };
    case 'slack': return { url: target.url, body: { text } };
    case 'telegram': return { url: `https://api.telegram.org/bot${target.url}/sendMessage`, body: { chat_id: target.chatId, text, disable_web_page_preview: true } };
    case 'json': return { url: target.url, body: { event, title, message, time: new Date(time).toISOString(), source: 'openterm' } };
  }
}

export class Notifier {
  private targets: NotificationTarget[] = [];
  private readonly sent = new Map<string, number[]>();
  private readonly failing = new Set<string>();

  constructor(private readonly journal: (message: string) => void, private readonly post: (url: string, body: unknown) => Promise<{ ok: boolean; status: number }> = async (url, body) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: response.ok, status: response.status };
  }) {}

  setTargets(targets: NotificationTarget[]): void {
    this.targets = targets;
  }

  async send(target: NotificationTarget, event: NotificationEvent, title: string, message: string): Promise<boolean> {
    const now = Date.now();
    const recent = (this.sent.get(target.id) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= MAX_PER_MINUTE) return false;
    recent.push(now);
    this.sent.set(target.id, recent);
    const request = notificationRequest(target, event, title, message, now);
    try {
      const response = await this.post(request.url, request.body);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.failing.delete(target.id);
      return true;
    } catch (error) {
      if (!this.failing.has(target.id)) this.journal(`Notification to ${target.name} failed: ${(error as Error).message}`);
      this.failing.add(target.id);
      return false;
    }
  }

  notify(event: NotificationEvent, title: string, message: string): void {
    for (const target of this.targets) {
      if (target.isEnabled && target.events.includes(event)) void this.send(target, event, title, message);
    }
  }
}
