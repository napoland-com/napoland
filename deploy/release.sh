#!/bin/bash
# Starts a release on this server: release.sh <game image>. The files next to this script belong to
# that release. Called through SSM by tools/deploy.mjs, and by the first boot of a replacement server.
# If the new game does not become healthy, the previous release is started again and this fails.
set -euo pipefail
IMAGE="${1:?usage: release.sh <game image, e.g. <registry>/napoland/game:<commit>>}"
export HOME="${HOME:-/root}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LIVE=/data/napoland/release
set -a
# shellcheck source=/dev/null  # written by the server's first boot (infra/napoland.yaml)
source /etc/napoland.env
set +a

if [ "$HERE" != "$LIVE" ]; then
  # Copy over the live files in place: running containers mount folders from there.
  mkdir -p "$LIVE"
  cp -rf "$HERE"/. "$LIVE"/
fi
chmod 755 "$LIVE"/*.sh "$LIVE/napoland-compose"
install -m 755 "$LIVE/napoland-compose" /usr/local/bin/napoland-compose
install -m 644 "$LIVE"/systemd/napoland-backup.service "$LIVE"/systemd/napoland-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now napoland-backup.timer >/dev/null

echo "pulling $IMAGE"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${IMAGE%%/*}" >/dev/null 2>&1
# Pull before touching anything: a missing image leaves the running release alone.
GAME_IMAGE="$IMAGE" napoland-compose pull --quiet

PREVIOUS=""
if [ -f /data/napoland/image.env ]; then PREVIOUS="$(sed -n 's/^GAME_IMAGE=//p' /data/napoland/image.env)"; fi
echo "GAME_IMAGE=$IMAGE" > /data/napoland/image.env

echo "starting"
if ! napoland-compose up -d --remove-orphans --wait --wait-timeout 180; then
  echo "the new release did not become healthy; last game log lines:"
  napoland-compose logs --tail 40 game || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$IMAGE" ]; then
    echo "starting the previous release again: $PREVIOUS"
    echo "GAME_IMAGE=$PREVIOUS" > /data/napoland/image.env
    napoland-compose up -d --remove-orphans --wait --wait-timeout 180 || true
  fi
  exit 1
fi
# Picks up a changed Caddyfile; does nothing when it did not change.
napoland-compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null

# Old game images pile up with every release; keep a week and a half for quick rollbacks.
docker image prune -af --filter "until=240h" >/dev/null || true
echo "released $IMAGE"
