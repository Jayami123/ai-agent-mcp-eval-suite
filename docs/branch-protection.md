# Suggested branch protection (apply by hand)

Apply these settings in GitHub → the suite repo → Settings → Branches → Add rule, once after the first push. The repository owner applies them; nothing in this repo applies them automatically.

- Branch name pattern: `main`
- Require a pull request before merging
- Dismiss stale pull request approvals when new commits are pushed
- Allow merge commits only. Disable squash merging and rebase merging.
- Do not allow force pushes
- Do not allow deletions
- Require status checks to pass before merging. Select these checks (from `.github/workflows/pr.yml`, job `stub`, matrix on Node 22 and 24):
  - `pr / stub (22)`
  - `pr / stub (24)`

The bootstrap `ci.yml` check (`CI / check`) was removed in favour of `pr.yml`. Do not select it.

The `l1 librechat stub` and `l1 openclaw stub` jobs in the same workflow run real products through the harness. Keep them out of the required checks until the owner has seen them stable; they are advisory at first.
