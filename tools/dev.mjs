// Runs the game server (:8080, in-memory storage unless DATABASE_URL is set) and the Vite client
// (:5173, reachable from phones on the same Wi-Fi) together. Ctrl+C stops both. Usage: npm run dev
import { spawn } from 'node:child_process';

const procs = [
  ['server', '\x1b[36m', ['run', 'dev', '-w', '@napoland/server']],
  ['client', '\x1b[35m', ['run', 'dev', '-w', '@napoland/client']],
].map(([name, color, args]) => {
  const p = spawn('npm', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
