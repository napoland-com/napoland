#!/bin/bash
# Full database dump to S3; the bucket deletes dumps after 30 days. Run nightly by napoland-backup.timer,
# or by hand before risky changes. Restore steps: docs/OPERATIONS.md.
set -euo pipefail
export HOME="${HOME:-/root}"
set -a
# shellcheck source=/dev/null  # written by the server's first boot (infra/napoland.yaml)
source /etc/napoland.env
set +a
KEY="backups/napoland-$(date -u +%Y-%m-%dT%H%MZ).dump"
napoland-compose exec -T db pg_dump -U napoland -d napoland --format=custom \
  | aws s3 cp - "s3://$BUCKET/$KEY" --region "$AWS_REGION" --only-show-errors
echo "backup saved to s3://$BUCKET/$KEY"
