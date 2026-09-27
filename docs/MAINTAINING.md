# Maintaining napoland on GitHub

> **Maintainers only.** Contributors and their AI agents do not need this and must not act on it.

A proposal for the maintainers: the GitHub settings that make pull requests safe to merge when every merge to `main` goes to production, and how to review. **Nothing here has been applied yet.** Apply it once the repository is public: on GitHub's free plan, branch protection exists only for public repositories (a private one gets a 403, "Upgrade ... or make this repository public"), and so do several of the security settings.

The commands use the GitHub CLI (`gh`), signed in as the owner, in bash (Git Bash on Windows). In PowerShell, pipe the JSON in from a here-string instead: `@' {...} '@ | gh api --method PUT <path> --input -`.

## 1. Protect main

| Rule | Why |
|---|---|
| Pull requests, with one approval | A maintainer reads every change before it reaches players. |
| The CI `check` job must pass | `npm run check` with PostgreSQL, plus the generated maps check. |
| Up to date with `main` before merging (`strict`) | What CI tested is exactly what gets released. |
| New commits dismiss an approval | Nothing slips in between the review and the merge. |
| No force pushes, no deleting `main` | `main` is the release history. |

```bash
gh api --method PUT repos/napoland-com/napoland/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "check", "app_id": 15368 }]
  },
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": false
}
JSON
```

- `check` is the job's name in [.github/workflows/ci.yml](../.github/workflows/ci.yml), and `15368` is the GitHub Actions app, so only a real CI run can satisfy it. If the job is ever renamed, change it here too.
- `enforce_admins: false` because napoland has one maintainer. GitHub does not let anyone approve their own pull request, so the owner has to be able to merge their own, and it keeps today's way of releasing (pushing straight to `main`) working until everything goes through pull requests. GitHub reports every bypass in the push output and on the pull request. Force pushes and deleting `main` stay blocked even for admins, and a release still needs CI to pass, because the deploy job waits for the `check` job. With a second maintainer, set it to `true`: then the rules hold for everyone, and the two approve each other's pull requests.
- `require_last_push_approval` stays off for the same reason: with it, a maintainer who updates a contributor's branch would need a second maintainer's approval.

Check the result with `gh api repos/napoland-com/napoland/branches/main/protection`.

## 2. Merging

```bash
gh api --method PATCH repos/napoland-com/napoland --input - <<'JSON'
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "COMMIT_MESSAGES",
  "allow_update_branch": true,
  "delete_branch_on_merge": true
}
JSON
```

- Squash only: one pull request becomes one commit on `main` and one release, and the history keeps reading like it does today. Tidy the message in the merge dialog so it says what changed and why.
- `allow_update_branch` shows the **Update branch** button on every pull request that is behind `main`.
- `delete_branch_on_merge` removes merged branches.

## 3. Security

```bash
# Private vulnerability reporting: SECURITY.md sends reports there. Public repositories only.
gh api --method PUT repos/napoland-com/napoland/private-vulnerability-reporting

# Secret scanning, with push protection so that a push containing a secret is refused.
gh api --method PATCH repos/napoland-com/napoland --input - <<'JSON'
{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }
JSON

# Dependabot alerts about vulnerable dependencies (alerts only, no automatic pull requests).
gh api --method PUT repos/napoland-com/napoland/vulnerability-alerts
```

The code of conduct's contact is conduct@neuramare.com; the license is AGPL-3.0-or-later for code ([LICENSE](../LICENSE)) and CC BY-SA 4.0 for `content/` ([content/LICENSE](../content/LICENSE)).

## 4. Pull requests from forks

CI runs a fork's pull request with a read-only token and no secrets, and the release job runs only for `main`, whose AWS role trusts nothing else, so a fork cannot reach production. So that strangers cannot use CI for something else, a first-time contributor's workflows wait for a maintainer's approval:

```bash
gh api --method PUT repos/napoland-com/napoland/actions/permissions/fork-pr-contributor-approval -f approval_policy=first_time_contributors
```

It is the same as the fork pull request approval setting under Settings, Actions, General. GitHub refuses this call for private repositories.

## 5. The conflicts label

[.github/workflows/conflicts.yml](../.github/workflows/conflicts.yml) creates the label on its first run. To create it now, with the same color and description:

```bash
gh label create conflicts --repo napoland-com/napoland --color d93f0b --description "Does not merge cleanly: update the branch from main"
```

The workflow runs with `pull_request_target`, so that it can label pull requests from forks. Its header explains why that is safe: it never checks out or runs anything from a pull request. Keep it that way in every change to it.

## Reviewing a pull request

- CI is green and the branch is up to date with `main`.
- Tests come with the change, and anything visible has screenshots in portrait and landscape.
- Versions (`PROTOCOL_VERSION`, maps, items) are bumped where needed and do not collide with `main`; a new migration only adds things and has the next free number.
- A roadmap item it finishes is set to `done`.
- **Extra care** with changes to `.github/workflows/`, `tools/deploy.mjs`, `deploy/`, `infra/` and `docker/`: once merged they run on `main`, with the role that deploys to production.
- To update a contributor's branch: **Update branch**, or `gh pr checkout <number>`, `git merge origin/main`, fix, `npm run gen` if maps conflicted, `npm run check`, `git push` (this needs "Allow edits by maintainers" on the pull request).
- Approve, then squash-merge. Follow the release with `gh run watch`, then check https://www.napoland.com/health (its `version` is the commit).

## Later: a merge queue

napoland belongs to an organization (napoland-com), so once the repository is public it can use a merge queue. With one, pull requests are tested on top of each other in the order they were queued and merged in that order, so "up to date before merging" no longer means updating branches by hand. It needs `merge_group` among the triggers of `.github/workflows/ci.yml` and "Require merge queue" in the rules for `main`.
