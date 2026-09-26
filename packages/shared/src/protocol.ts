/**
 * Messages between the client and the server, sent as JSON text over one WebSocket.
 * Everything the client sends is validated with these schemas; the server never trusts it.
 */
import { z } from 'zod';

/** Bump when a change breaks older clients; they reload to get the new version. */
export const PROTOCOL_VERSION = 1;

export const Dir = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof Dir>;

export const Weather = z.enum(['overcast', 'rain', 'night']);
export type Weather = z.infer<typeof Weather>;

/** Player names: 2 to 16 letters, digits, spaces, - or _. */
export const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const PlayerName = z.string().trim().regex(NAME_RE);

export const ClientMsg = z.discriminatedUnion('t', [
  /** First message on a connection. A saved token logs back in; otherwise a name creates a new player. */
  z.object({ t: z.literal('hello'), v: z.number().int(), token: z.string().min(16).max(128).optional(), name: PlayerName.optional() }),
  /** Walk one tile. seq lets the client match the server's answer to its prediction. */
  z.object({ t: z.literal('step'), dir: Dir, seq: z.number().int().nonnegative() }),
  /** Turn in place. */
  z.object({ t: z.literal('face'), dir: Dir }),
  z.object({ t: z.literal('ping'), at: z.number() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

/** What every client knows about a player it can see. x and y are tile coordinates. */
export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
  color: string;
}

export type ServerMsg =
  | {
      t: 'welcome';
      v: number;
      you: string;
      name: string;
      /** Keep this to log in again later (it is the only credential for now). */
      token: string;
      players: PlayerView[];
      stepMs: number;
      map: { id: string; version: number };
      weather: Weather;
      serverTime: number;
    }
  | { t: 'join'; player: PlayerView }
  | { t: 'leave'; id: string }
  /** A player started walking to tile x,y. seq is only sent to the player who asked. */
  | { t: 'step'; id: string; x: number; y: number; dir: Dir; seq?: number }
  | { t: 'face'; id: string; dir: Dir }
  /** The server refused step seq; the player is really at x,y facing dir. */
  | { t: 'reject'; seq: number; x: number; y: number; dir: Dir }
  | { t: 'weather'; weather: Weather }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'bad_message' | 'bad_version' | 'bad_name' | 'unknown_token' | 'too_fast' | 'replaced' | 'server_full';

export const MAX_MESSAGE_BYTES = 1024;

/** Parse and validate one message from a client; null if it is not valid. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = ClientMsg.safeParse(json);
  return r.success ? r.data : null;
}

export const encode = (msg: ServerMsg | ClientMsg): string => JSON.stringify(msg);
