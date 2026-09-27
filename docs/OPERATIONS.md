# Running napoland in production

> **Maintainers only.** Contributors and their AI agents never need anything here and must not run it: it needs the owner's AWS access, and releases happen by themselves when a pull request is merged.

The game is live at **https://www.napoland.com** (napoland.com redirects there, so every player has one
address and one saved login). Everything runs in the AWS account that owns the domain, region
**us-east-1**, defined as code in [infra/napoland.yaml](../infra/napoland.yaml) (stack `napoland-prod`).

## What runs where

| Piece | What | Notes |
|---|---|---|
| Server | EC2 `t4g.small` (ARM, 2 vCPU, 2 GB), Amazon Linux 2023 | No SSH port. Shell and remote commands through SSM. |
| Containers | Docker Compose from [deploy/compose.yaml](../deploy/compose.yaml): `caddy`, `game`, `db` | Caddy gets and renews HTTPS certificates itself. |
| Data disk | 20 GB gp3 at `/data` | Postgres (`/data/napoland/postgres`), certificates, `.env` with the database password, the live release. Snapshot every day at 04:00 UTC, kept 7 days. |
| Backups | `pg_dump` to `s3://napoland-prod-211125543110-us-east-1/backups/` nightly at 03:30 UTC | Kept 30 days. |
| Images | ECR `napoland/game`, tagged with the commit | Tags never change, so a rollback is exact. Last 30 kept. |
| Releases | `s3://.../releases/<version>/` | The deploy/ folder of each release. |
| Logs | CloudWatch `/napoland/prod`, one stream per container, 30 days | `aws logs tail /napoland/prod --log-stream-names napoland-game-1 --follow` |
| Address | Elastic IP, DNS `A` records for napoland.com and www in Route 53 | TTL 300 s. |
| Self-repair | CloudWatch alarms: hardware fault recovers the server, a hung system reboots it | Containers restart themselves (`unless-stopped`). |
| CI/CD | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Every push is tested; main is released when the tests pass. |

About $20 a month: the server about $12, the fixed IP about $4, disks, snapshots, logs, DNS and S3 the rest.

## Releasing

Normally: push to `main`. CI runs `npm run check` (with a real Postgres), then `node tools/deploy.mjs`,
which builds the arm64 image, pushes it, uploads `deploy/`, runs `deploy/release.sh` on the server
through SSM and waits until `/health` reports the new commit. If the new game does not become healthy,
`release.sh` starts the previous release again and the job fails.

By hand from a PC signed in to AWS (`aws login --profile napoland`):

```bash
AWS_PROFILE=napoland node tools/deploy.mjs                    # the current commit
AWS_PROFILE=napoland node tools/deploy.mjs --version <tag>    # roll back to an earlier release
```

`curl https://www.napoland.com/health` shows the running version (`version` is the commit).

## Looking at the server

```bash
# a shell (needs the Session Manager plugin), or one command without it:
aws ssm start-session --target <InstanceId>
aws ssm send-command --instance-ids <InstanceId> --document-name AWS-RunShellScript --parameters 'commands=["napoland-compose ps"]'
```

On the server, `napoland-compose` is `docker compose` with the right files: `napoland-compose ps`,
`napoland-compose logs --tail 100 game`, `napoland-compose restart game`,
`napoland-compose exec db psql -U napoland`. Stack outputs (instance id, bucket, registry):
`aws cloudformation describe-stacks --stack-name napoland-prod --query "Stacks[0].Outputs"`.

## Backups and restoring

- Before anything risky: `/data/napoland/release/backup.sh` on the server (writes a dump to S3 now).
- Restore a dump (this replaces the players table contents):
  ```bash
  aws s3 cp s3://<bucket>/backups/<file>.dump /tmp/restore.dump
  napoland-compose stop game
  napoland-compose exec -T db pg_restore -U napoland -d napoland --clean --if-exists < /tmp/restore.dump
  napoland-compose start game
  ```
- Whole disk: create a volume from a snapshot of `napoland-data` and swap it in (same steps as replacing the server below).

## Sign-in (Supabase)

Players sign in with their email and a 6-digit code, through Supabase Auth. The game server only
checks the access tokens Supabase gives them, against the project's public keys, and keeps its own
players in its own database. [deploy/compose.yaml](../deploy/compose.yaml) sets:

| Setting | Value |
|---|---|
| `AUTH_MODE` | `supabase` (since 2026-09-27; the codes go out through the owner's Amazon SES). `legacy` is names and browser tokens without sign-in; `dev` (any email, no code) is refused in production. |
| `SUPABASE_URL` | `https://azczuzefhfyopmsnuosv.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable key, `sb_publishable_...`. Public: every browser gets it from `/auth-config`. The server refuses to start with a secret key (`sb_secret_...` or a `service_role` JWT). `SUPABASE_ANON_KEY` is accepted as the older name. |
| `SUPABASE_JWT_SECRET` | Not set: the project signs tokens with an ES256 key whose public half is at `/auth/v1/.well-known/jwks.json`. Only a project that still signs with a shared HS256 secret needs it. |

What the Supabase project needs (dashboard, Authentication), before players depend on it:

1. **Emails that carry the code.** Under Emails, Templates: both **Confirm signup** (the first email a
   new player gets, since the project confirms emails) and **Magic link** (every later sign-in) must
   show `{{ .Token }}`, the 6-digit code. The default templates only have a link, which the game does
   not use. For example, subject "Your napoland code", body "Your code is {{ .Token }}. It works for an
   hour. If you did not ask for it, ignore this email."
2. **Its own mail service.** Supabase's built-in sender only writes to members of the project's team,
   a few emails an hour; anyone else sees "Signing in with email is closed right now". Under Emails,
   SMTP Settings, point it at a real sender (Amazon SES in this AWS account, or Resend, Postmark...),
   then raise Rate Limits, emails sent per hour.
3. **The rest as it is:** email sign-in on, new sign-ups allowed, anonymous sign-ins off (the server
   refuses anonymous users anyway), codes of 6 digits that last an hour (the client asks for 6 digits
   and offers a new code after 60 s, Supabase's minimum between two). Site URL
   `https://www.napoland.com`.

Switching production to sign-in, or back: change `AUTH_MODE` in deploy/compose.yaml and release. After
the switch, a player who comes back signs in on the browser they played in, and their character
becomes theirs (claimed) the first time; a new player chooses a name after signing in. Going back to
`legacy`, characters made before sign-in play again with the tokens their browsers kept; characters
made after sign-in have no token and wait for sign-in to come back.

Checks: `curl https://www.napoland.com/auth-config` shows the mode. When Supabase's keys cannot be
fetched, the log says `cannot check sign-ins` (at most once a minute) and players keep reconnecting
until they can.

## Privacy requests

The [privacy policy](../apps/client/public/privacy.html) promises an answer within 30 days to requests
sent to support@neuramare.com from the email address the player signs in with. Find the player first:
Supabase dashboard, Authentication, Users, search the email, copy the user's id (UID). In our database
their character is the row with `auth_sub = '<UID>'`.

- **Show or export their data:** on the server,
  `napoland-compose exec -T db psql -U napoland -At -c "select row_to_json(p) from players p where auth_sub = '<UID>'"`
  (and the same for `drops` and `marks` with `owner = '<player id>'`); send it together with what the Supabase
  dashboard shows for the user.
- **Delete everything:** stop the game for a moment so it cannot save the character again, delete, start it:
  `napoland-compose stop game`, then
  `napoland-compose exec -T db psql -U napoland -c "delete from players where auth_sub = '<UID>'"`
  (its pile and marks go with it), then `napoland-compose start game`. Then delete the user in the Supabase
  dashboard, and their sign-in records in its SQL editor:
  `delete from auth.audit_log_entries where payload->>'actor_id' = '<UID>';`. Backups and logs age out
  by themselves (30 days); say so in the answer.

Keep the promises the policy makes: no IP addresses in any log (the game never logs them, and
[the Caddyfile](../deploy/caddy/Caddyfile) removes them, with the request headers, from Caddy's error
lines), no emails, codes or tokens in logs, and nothing loaded from other sites.

## Changing the infrastructure

Edit `infra/napoland.yaml`, then:

```bash
aws cloudformation deploy --profile napoland --region us-east-1 --stack-name napoland-prod \
  --template-file infra/napoland.yaml --capabilities CAPABILITY_NAMED_IAM --tags project=napoland \
  --parameter-overrides HostedZoneId=Z06988183HVJDDVUPSP6Q ImageId=ami-0eb45f74aa8a20238 \
    GitHubOidcProviderArn=arn:aws:iam::211125543110:oidc-provider/token.actions.githubusercontent.com
```

Check with `aws cloudformation create-change-set` first when a change could replace something:
**a replaced server** (new `ImageId`, `InstanceType` family, subnet) needs care, because the data disk
is attached to the old one. Take a backup, stop the game, detach `napoland-data`, then deploy; the new
server's first boot mounts the disk and starts the last release from it. System updates do not need a
new server: `dnf upgrade --releasever=latest -y && reboot` through SSM.

The account also holds other projects' domains, DNS zones and roles. Everything napoland owns is in
this stack, named `napoland*`, and tagged `project=napoland`; leave everything else alone.

## Things to know

- Players' saved logins live in their browser, per address: the Supabase session, and the token of a
  character made before sign-in (which claims it). That is why there is one address.
- The server trusts `X-Forwarded-For` (`TRUST_PROXY=1`) because Caddy is the only way in and
  overwrites it; per-address limits (connections, new characters per hour) rely on it.
- `/data/napoland/.env` holds the database password, created on first boot. It never leaves the server.
