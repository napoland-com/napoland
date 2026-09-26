// Releases napoland to production (the napoland-prod stack from infra/napoland.yaml):
//   1. builds the game image for the server's CPU (linux/arm64) and pushes it to ECR, tagged with the commit
//   2. uploads deploy/ (compose file, Caddyfile, scripts) to S3 next to it
//   3. tells the server through SSM to run deploy/release.sh with that image (it rolls back by itself
//      if the new game does not become healthy)
//   4. waits until https://www.napoland.com/health reports the new version
// CI runs this after the tests pass on main. By hand: AWS_PROFILE=napoland node tools/deploy.mjs
//   --version <tag>   release an image that was built before (a rollback); nothing is built
//   --allow-dirty     release uncommitted changes (the tag gets a -dirty-<time> suffix)
//   --stack <name>    another stack than napoland-prod
// Needs git, docker with buildx, and the AWS CLI (AWS_CLI may point at aws.exe if it is not on PATH).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AWS = process.env.AWS_CLI ?? 'aws';
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = name => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const stack = option('stack') ?? 'napoland-prod';
const rollbackTo = option('version');

const say = text => console.log(`\x1b[36m[deploy]\x1b[0m ${text}`);
// Returns the command's output (nothing when its output goes straight to the console).
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts }) ?? '').trim();
const aws = (...args) => run(AWS, [...args, '--region', REGION, '--output', 'json']);
const awsJson = (...args) => JSON.parse(aws(...args) || 'null');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- what and where ----------
const outputs = Object.fromEntries(
  awsJson('cloudformation', 'describe-stacks', '--stack-name', stack).Stacks[0].Outputs.map(o => [o.OutputKey, o.OutputValue]),
);
const { RepositoryUri: repo, BucketName: bucket, InstanceId: instance, SiteUrl: site } = outputs;

let version = rollbackTo;
if (!version) {
  version = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 12) : run('git', ['rev-parse', '--short=12', 'HEAD']);
  if (run('git', ['status', '--porcelain'])) {
    if (!flag('allow-dirty')) throw new Error('Uncommitted changes. Commit them, or pass --allow-dirty to release them anyway.');
    version += `-dirty-${Date.now().toString(36)}`;
  }
}
const image = `${repo}:${version}`;
const prefix = `releases/${version}/`;
say(`releasing ${version} to ${site} (stack ${stack})`);

// ---------- image ----------
const imageExists = () => {
  try {
    aws('ecr', 'describe-images', '--repository-name', repo.split('/').slice(1).join('/'), '--image-ids', `imageTag=${version}`);
    return true;
  } catch {
    return false;
  }
};
if (imageExists()) {
  say(`image ${version} is already in the registry`);
} else if (rollbackTo) {
  throw new Error(`There is no image ${rollbackTo} in ${repo}.`);
} else {
  say('logging in to the registry');
  const password = run(AWS, ['ecr', 'get-login-password', '--region', REGION]);
  run('docker', ['login', '--username', 'AWS', '--password-stdin', repo.split('/')[0]], { input: password, stdio: ['pipe', 'pipe', 'pipe'] });
  say('building and pushing the image (linux/arm64)');
  run('docker', ['buildx', 'build', '--platform', 'linux/arm64', '--provenance=false', '--sbom=false', '--file', 'docker/Dockerfile',
    '--build-arg', `APP_VERSION=${version}`, '--tag', image, '--push', '.'], { stdio: 'inherit' });
}

// ---------- release files ----------
if (!rollbackTo) {
  say(`uploading deploy/ to s3://${bucket}/${prefix}`);
  aws('s3', 'cp', '--recursive', '--only-show-errors', join(ROOT, 'deploy'), `s3://${bucket}/${prefix}`);
}

// ---------- tell the server ----------
const commands = [
  'set -eu',
  'export HOME=/root',
  'rm -rf /data/napoland/release.next && mkdir -p /data/napoland/release.next',
  `aws s3 cp --recursive --only-show-errors s3://${bucket}/${prefix} /data/napoland/release.next/ --region ${REGION}`,
  `bash /data/napoland/release.next/release.sh ${image}`,
];
const dir = mkdtempSync(join(tmpdir(), 'napoland-deploy-'));
const paramsFile = join(dir, 'params.json');
writeFileSync(paramsFile, JSON.stringify({ commands, executionTimeout: ['900'] }));
let commandId;
try {
  commandId = awsJson('ssm', 'send-command', '--instance-ids', instance, '--document-name', 'AWS-RunShellScript',
    '--comment', `napoland release ${version}`.slice(0, 100), '--timeout-seconds', '600', '--parameters', `file://${paramsFile}`).Command.CommandId;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
say(`server is starting it (SSM command ${commandId})`);

let result;
for (;;) {
  await sleep(4000);
  try {
    result = awsJson('ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instance);
  } catch {
    continue; // the invocation shows up a few seconds after the command
  }
  if (!['Pending', 'InProgress', 'Delayed'].includes(result.Status)) break;
}
const out = `${result.StandardOutputContent ?? ''}${result.StandardErrorContent ? `\n${result.StandardErrorContent}` : ''}`.trim();
if (out) console.log(out.replace(/^/gm, '  | '));
if (result.Status !== 'Success') throw new Error(`The release failed on the server (${result.Status}).`);

// ---------- check from the outside ----------
say(`checking ${site}/health`);
const deadline = Date.now() + 180_000;
let last = '';
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${site}/health`);
    const body = await res.json();
    last = `${res.status} ${JSON.stringify(body)}`;
    if (res.ok && body.version === version) {
      say(`live: ${site} runs ${version} (${body.players} online)`);
      process.exit(0);
    }
  } catch (err) {
    last = String(err?.cause?.code ?? err?.message ?? err); // the first HTTPS certificate takes a few seconds
  }
  await sleep(3000);
}
throw new Error(`${site}/health never reported ${version}; last answer: ${last}`);
