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

Before releasing anything that changes what is saved (a migration, or new fields in the players' jsonb), take a backup (`/data/napoland/release/backup.sh`, Backups and restoring below), and restore it if you roll back past that release: an older release saves players with only what it knows.

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

Players sign in with their email and a 6-digit code, or with Google or Apple once they are set up
(below), through Supabase Auth. The game server only checks the access tokens Supabase gives them,
against the project's public keys, and keeps its own players in its own database.
[deploy/compose.yaml](../deploy/compose.yaml) sets:

| Setting | Value |
|---|---|
| `AUTH_MODE` | `supabase` (since 2026-09-27; the codes go out through the owner's Amazon SES). `legacy` is names and browser tokens without sign-in; `dev` (any email, no code) is refused in production. |
| `SUPABASE_URL` | `https://azczuzefhfyopmsnuosv.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable key, `sb_publishable_...`. Public: every browser gets it from `/auth-config`. The server refuses to start with a secret key (`sb_secret_...` or a `service_role` JWT). `SUPABASE_ANON_KEY` is accepted as the older name. |
| `SUPABASE_JWT_SECRET` | Not set: the project signs tokens with an ES256 key whose public half is at `/auth/v1/.well-known/jwks.json`. Only a project that still signs with a shared HS256 secret needs it. |
| `AUTH_PROVIDERS` | Not set yet: the sign-in card offers the email code alone. `google,apple` (or just one) once each is set up (Google and Apple, below); the card shows their buttons in that order. A name other than `google` or `apple` stops the server. |

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

**Google and Apple.** The card offers only the providers `AUTH_PROVIDERS` lists, so set each one up
first, then list it. Both send players to Supabase's callback,
`https://azczuzefhfyopmsnuosv.supabase.co/auth/v1/callback`, which sends them back to the game.

1. **Google** ([Google Cloud console](https://console.cloud.google.com), a project for napoland), under
   Google Auth Platform: in Branding, the app name napoland, a support email, the home page
   `https://www.napoland.com`, the privacy policy `https://www.napoland.com/privacy.html` and the
   authorized domains `napoland.com` and `supabase.co`; in Audience, External, published to production;
   in Data access, only `openid`, `userinfo.email` and `userinfo.profile`. Then Clients, Create client,
   Web application: authorized JavaScript origin `https://www.napoland.com`, authorized redirect URI
   Supabase's callback. Keep its client ID and client secret for step 3.
2. **Apple** ([Apple Developer](https://developer.apple.com/account), Certificates, Identifiers &
   Profiles): an App ID with Sign in with Apple on (Apple wants one even without an app); a Services ID
   (say `com.napoland.web`) with Sign in with Apple on, configured with that App ID as primary, the
   domain `azczuzefhfyopmsnuosv.supabase.co` and Supabase's callback as return URL; and a key with Sign
   in with Apple on, for that App ID. Download its `.p8` file (Apple gives it once) and note its Key ID
   and the Team ID; from these, the tool in Supabase's Apple guide makes the secret key for step 3.
   **That secret lasts six months at most:** make a new one before then (set a reminder), or Sign in
   with Apple stops working. Under Services, Sign in with Apple for Email Communication, register the
   addresses our mail comes from (the codes' sender in SES, support@neuramare.com): Apple forwards mail
   to players who hid their email only from registered senders.
3. **Supabase** dashboard, Authentication: under Sign In / Providers, turn on Google (client ID and
   client secret from step 1) and Apple (Client IDs: the Services ID; Secret Key (for OAuth): the secret
   from step 2). Under URL Configuration, keep the Site URL `https://www.napoland.com` and add
   `https://www.napoland.com` to Redirect URLs: that is where the game asks to come back to.
4. **The game:** in [deploy/compose.yaml](../deploy/compose.yaml), under `game`, `environment`, add
   `AUTH_PROVIDERS: google,apple` (or only the one that is set up), then release. The buttons show from
   the next page load; `curl https://www.napoland.com/auth-config` lists them. Try each on a phone:
   a guest who signs in keeps their character. Try an email code too: the client uses Supabase's
   PKCE flow for every sign-in, the email code included, whether or not a provider is listed.

Supabase links an account's sign-ins by their email address: someone who played with an email code
and signs in with Google or Apple under the same address plays the same character. Apple's hidden
addresses are new ones, so a new account.

Switching production to sign-in, or back: change `AUTH_MODE` in deploy/compose.yaml and release. After
the switch, a player who comes back signs in on the browser they played in, and their character
becomes theirs (claimed) the first time; a new player chooses a name after signing in. Going back to
`legacy`, characters made before sign-in play again with the tokens their browsers kept; characters
made after sign-in have no token and wait for sign-in to come back.

Checks: `curl https://www.napoland.com/auth-config` shows the mode and the providers. When Supabase's
keys cannot be fetched, the log says `cannot check sign-ins` (at most once a minute) and players keep
reconnecting until they can.

## Privacy requests

The [privacy policy](../apps/client/public/privacy.html) promises an answer within 30 days to requests
sent to support@neuramare.com from the email address the player signs in with. Find the player first:
Supabase dashboard, Authentication, Users, search the email, copy the user's id (UID). In our database
their character is the row with `auth_sub = '<UID>'`. Someone who signed in with Apple and hid their
email is under an `@privaterelay.appleid.com` address (their Apple account shows it, under Sign in
with Apple): answer to that address, which only reaches them, and go on once they reply.

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
