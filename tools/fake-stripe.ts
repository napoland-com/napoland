/**
 * A fake Stripe for play-testing the shop on this machine, never the real one: it opens "checkouts" the way
 * Stripe's API does (POST /v1/checkout/sessions, test keys only), shows a page of its own where a tap pays or
 * cancels, sends the game the webhook events Stripe would (a checkout paid, a charge refunded), signed with
 * the same secret the game checks, and lists what it sold, with a button to refund each. /terms stands in for
 * the owner's terms of sale (SHOP_TERMS_URL=http://localhost:12111/terms).
 *
 *   npm run fake-stripe                     on http://localhost:12111, sending events to http://localhost:8080
 *   FAKE_STRIPE_PORT, GAME_SERVER (host:port), STRIPE_WEBHOOK_SECRET (whsec_playtest_on_this_machine unless
 *   set: give the game the same), FAKE_STRIPE_DELAY_MS (the event comes this long after the page sends the
 *   player back: 3000 unless set, so "being confirmed" shows)
 *
 * Run the game with STRIPE_API=http://localhost:12111 (and the other shop settings: docs/OPERATIONS.md, and
 * the play-test in the pull request). Nothing here reaches the internet, and nothing is charged.
 */
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { signPayload } from '../apps/server/src/stripe';

/**
 * The webhook's signing secret unless STRIPE_WEBHOOK_SECRET says otherwise: made up, for this machine only.
 * Its underscores keep it from looking like a real one (whsec_ and 32 letters and digits) to a secret scanner.
 */
export const PLAYTEST_SECRET = 'whsec_playtest_on_this_machine';

export interface FakeSession {
  id: string;
  url: string;
  look: string;
  player: string;
  name: string;
  amount: number;
  currency: string;
  waiver: string;
  success: string;
  cancel: string;
  paymentIntent: string;
  status: 'open' | 'paid' | 'cancelled' | 'refunded';
}

export interface FakeStripe {
  readonly port: number;
  readonly sessions: Map<string, FakeSession>;
  close(): Promise<void>;
}

/** Starts the fake Stripe on `port` (0: a free one), on this machine only, sending its events to `game` (an origin) signed with `secret`. */
export async function startFakeStripe(o: { port: number; game: string; secret: string; delayMs?: number }): Promise<FakeStripe> {
  const sessions = new Map<string, FakeSession>();
  let n = 0;
  let base = '';

  /** Sends the game a webhook event as Stripe would: signed now, with the endpoint's secret. */
  const tell = (type: string, object: object): Promise<number> => {
    const body = JSON.stringify({ id: `evt_fake_${++n}`, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
    return new Promise(resolve => {
      const req = request(`${o.game}/stripe-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signPayload(body, o.secret, Math.floor(Date.now() / 1000)) } }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', () => resolve(0));
      req.end(body);
    });
  };
  const paid = (s: FakeSession) => tell('checkout.session.completed', {
    id: s.id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: s.amount, currency: s.currency, payment_intent: s.paymentIntent,
    client_reference_id: s.player, metadata: { napoland_player: s.player, napoland_look: s.look }, livemode: false,
  });
  const refunded = (s: FakeSession) => tell('charge.refunded', {
    id: `ch_fake_${s.id}`, object: 'charge', payment_intent: s.paymentIntent, amount: s.amount, amount_refunded: s.amount, refunded: true, livemode: false,
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const auth = req.headers.authorization ?? '';
      // Test keys only: a live key has no business on this machine.
      if (!/^Bearer (sk|rk)_test_/.test(auth)) return json(res, 401, { error: { type: 'invalid_request_error', code: 'api_key_expired', message: 'The fake Stripe takes test keys only.' } });
      const form = new URLSearchParams(await text(req));
      const id = `cs_test_fake_${++n}`;
      const s: FakeSession = {
        id, url: `${base}/pay/${id}`, look: form.get('metadata[napoland_look]') ?? '', player: form.get('metadata[napoland_player]') ?? '',
        name: form.get('line_items[0][price_data][product_data][name]') ?? 'A look', amount: Number(form.get('line_items[0][price_data][unit_amount]')),
        currency: form.get('line_items[0][price_data][currency]') ?? 'eur', waiver: form.get('custom_text[submit][message]') ?? '',
        success: form.get('success_url') ?? '/', cancel: form.get('cancel_url') ?? '/', paymentIntent: `pi_fake_${n}`, status: 'open',
      };
      sessions.set(id, s);
      return json(res, 200, { id: s.id, object: 'checkout.session', url: s.url });
    }
    const s = path[0] === 'pay' || path[0] === 'refund' ? sessions.get(path[1] ?? '') : undefined;
    if (req.method === 'GET' && path[0] === 'pay' && s) return page(res, 200, payPage(s));
    if (req.method === 'POST' && path[0] === 'pay' && s && s.status === 'open' && (path[2] === 'paid' || path[2] === 'cancel')) {
      if (path[2] === 'cancel') {
        s.status = 'cancelled';
        return redirect(res, s.cancel);
      }
      s.status = 'paid';
      // Back to the game first, then Stripe's word a moment later: the game says the payment is being confirmed meanwhile.
      setTimeout(() => void paid(s), o.delayMs ?? 3000);
      return redirect(res, s.success);
    }
    if (req.method === 'POST' && path[0] === 'refund' && s && s.status === 'paid') {
      s.status = 'refunded';
      await refunded(s);
      return redirect(res, '/');
    }
    if (req.method === 'GET' && url.pathname === '/') return page(res, 200, listPage([...sessions.values()]));
    // A stand-in for the owner's terms of sale, so the Shop tab's link opens something here too.
    if (req.method === 'GET' && url.pathname === '/terms') return page(res, 200, TERMS);
    return page(res, 404, '<p>Nothing here.</p>');
  }

  const server: Server = createServer((req, res) => void handle(req, res).catch(() => page(res, 500, '<p>Something went wrong.</p>')));
  await new Promise<void>(resolve => server.listen(o.port, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://localhost:${port}`;
  return { port, sessions, close: () => new Promise(resolve => server.close(() => resolve())) };
}

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (s: FakeSession) => `${(s.amount / 100).toFixed(2)} ${s.currency.toUpperCase()}`;
const STYLE = 'body{margin:0;background:#0b1014;color:#e9e3d4;font:16px/1.5 system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:32px 16px}'
  + 'h1{font-size:22px;color:#ffcf5a}.fake{padding:8px 12px;border:2px dashed #f2a65a;border-radius:8px;color:#f2a65a}button{font:inherit;padding:10px 18px;margin:6px 8px 0 0;border-radius:8px;border:0}'
  + '.pay{background:#ffcf5a;color:#1a1a1a;font-weight:700}.cancel{background:#2a3140;color:#e9e3d4}td{padding:4px 8px}';
const TERMS = '<h1>Terms of sale</h1><p class="fake">A stand-in for the owner\'s terms of sale, for play-testing on this machine. In production the Shop tab links the owner\'s own page (SHOP_TERMS_URL).</p>';
function payPage(s: FakeSession): string {
  return `<h1>${esc(s.name)}</h1><p class="fake">A fake Stripe, for play-testing on this machine: nothing is charged.</p><p><b>${esc(money(s))}</b></p><p>${esc(s.waiver)}</p>`
    + (s.status === 'open'
      ? `<form method="post" action="/pay/${esc(s.id)}/paid" style="display:inline"><button class="pay">Pay (fake)</button></form><form method="post" action="/pay/${esc(s.id)}/cancel" style="display:inline"><button class="cancel">Cancel</button></form>`
      : `<p>This checkout is ${s.status}.</p>`);
}
function listPage(all: FakeSession[]): string {
  const rows = all.map(s => `<tr><td>${esc(s.id)}</td><td>${esc(s.look)}</td><td>${esc(money(s))}</td><td>${s.status}</td><td>${s.status === 'paid' ? `<form method="post" action="/refund/${esc(s.id)}"><button class="cancel">Refund</button></form>` : ''}</td></tr>`).join('');
  return `<h1>Fake Stripe</h1><p class="fake">For play-testing on this machine: nothing is charged, and nothing reaches Stripe.</p>${rows ? `<table>${rows}</table>` : '<p>Nothing sold yet.</p>'}`;
}
function page(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake Stripe</title><style>${STYLE}</style><main>${body}</main>`);
}
function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, to: string): void {
  res.writeHead(303, { Location: to });
  res.end();
}
function text(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let t = '';
    req.setEncoding('utf8');
    req.on('data', c => (t += c));
    req.on('end', () => resolve(t));
    req.on('error', reject);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The play-test's made-up secret unless another is set: the game must be given the same one.
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? PLAYTEST_SECRET;
  const game = `http://${process.env.GAME_SERVER ?? 'localhost:8080'}`;
  const f = await startFakeStripe({ port: Number(process.env.FAKE_STRIPE_PORT ?? 12111), game, secret, delayMs: Number(process.env.FAKE_STRIPE_DELAY_MS ?? 3000) });
  console.log(`Fake Stripe on http://localhost:${f.port}, sending events to ${game}/stripe-webhook. Nothing is charged; nothing reaches Stripe.`);
}
