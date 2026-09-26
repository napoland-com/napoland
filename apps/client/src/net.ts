/**
 * One WebSocket to the game server, reconnecting with backoff when it drops (phones lose the
 * connection all the time: screen locked, app switched, Wi-Fi to 4G).
 */
import { encode, type ClientMsg, type ServerMsg } from '@napoland/shared';

export class Connection {
  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  onMessage: (msg: ServerMsg) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  constructor(private readonly url: string, private readonly hello: () => ClientMsg) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  /** Close and stop reconnecting (for example when the server says the login is invalid). */
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      ws.send(encode(this.hello()));
      this.onOpen();
    };
    ws.onmessage = e => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClose();
      if (this.stopped) return;
      const delay = Math.min(8000, 400 * 2 ** this.retries++) * (0.8 + Math.random() * 0.4);
      this.timer = setTimeout(() => { if (!this.stopped) this.open(); }, delay);
    };
  }
}

export function serverUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
