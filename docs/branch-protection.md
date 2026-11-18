# Suggested branch protection (apply by hand)

Apply these settings in GitHub → the suite repo → Settings → Branches → Add rule, once after the first push. The repository owner applies them; nothing in this repo applies them automatically.

- Branch name pattern: `main`
- Require a pull request before merging
- Dismiss stale pull request approvals when new commits are pushed
- Allow merge commits only. Disable squash merging and rebase merging.
- Do not allow force pushes
- Do not allow deletions
- Require status checks to pass before merging. Select these checks (from `.github/workflows/pr.yml`, job `stub`, matrix on Node 20 and 22):
  - `pr / stub (20)`
  - `pr / stub (22)`

The bootstrap `ci.yml` check (`CI / check`) was removed in favour of `pr.yml`. Do not select it.
