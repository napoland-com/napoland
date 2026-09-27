// Runs the game server (:8080, in-memory storage unless DATABASE_URL is set) and the Vite client
// (:5173, reachable from phones on the same Wi-Fi) together. Ctrl+C stops both. Usage: npm run dev
// `node tools/dev.mjs server` (or `client`) runs only one of them, the same way: .claude/launch.json
// starts the server like this, so it gets the settings below too.
import { spawn } from 'node:child_process';

const only = process.argv[2];
if (only !== undefined && only !== 'server' && only !== 'client') {
  console.error('Usage: node tools/dev.mjs [server | client]');
  process.exit(2);
}

// Every local tab, phone (through Vite's /ws proxy) and test bot reaches the server from this PC's
// address, so the per-address limits are raised here. Sign-in is dev mode: an email, no code, so
// each tab can be someone else. Your own environment still wins (AUTH_MODE=legacy, say).
const serverEnv = { MAX_CONNECTIONS_PER_IP: '1000', NEW_PLAYERS_PER_IP_PER_HOUR: '1000', AUTH_MODE: 'dev' };

const procs = [
  ['server', '\x1b[36m', ['run', 'dev', '-w', '@napoland/server'], serverEnv],
  ['client', '\x1b[35m', ['run', 'dev', '-w', '@napoland/client'], {}],
].filter(([name]) => only === undefined || name === only).map(([name, color, args, env]) => {
  const p = spawn('npm', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, ...process.env } });
  const tag = `${color}[${name}]\x1b[0m `;
  for (const stream of [p.stdout, p.stderr]) {
    let buf = '';
    stream.on('data', chunk => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) process.stdout.write(tag + line + '\n');
    });
  }
  p.on('exit', code => { process.stdout.write(`${tag}exited with code ${code}\n`); stop(); });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
