/**
 * One WebSocket to the game server, reconnecting with backoff when it drops (phones lose the
 * connection all the time: screen locked, app switched, Wi-Fi to 4G).
 */
import { encode, type ClientMsg, type ServerMsg } from '@napoland/shared';

export class Connection {
  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = true;
  /** Counts starts: a hello still being prepared for an earlier one is dropped. */
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  onMessage: (msg: ServerMsg) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  /**
   * `hello` says what to send first, asked again for every connection (a sign-in token may have
   * been refreshed since). Null means there is nobody to sign in as: the connection stops. If it
   * throws (say the sign-in service is out of reach), the connection tries again later.
   */
  constructor(
    private readonly url: string,
    private readonly hello: () => ClientMsg | null | Promise<ClientMsg | null>,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.run++;
    void this.open();
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

  private async open() {
    const run = this.run;
    let hello: ClientMsg | null;
    try {
      hello = await this.hello();
    } catch {
      if (!this.stopped && run === this.run) this.retry();
      return;
    }
    if (this.stopped || run !== this.run) return;
    if (!hello) {
      this.stopped = true;
      return;
    }
    const first = hello;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      ws.send(encode(first));
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
      if (!this.stopped) this.retry();
    };
  }

  private retry() {
    const delay = Math.min(8000, 400 * 2 ** this.retries++) * (0.8 + Math.random() * 0.4);
    this.timer = setTimeout(() => {
      if (!this.stopped) void this.open();
    }, delay);
  }
}

export function serverUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
