# Suggested branch protection (apply by hand)

Apply these settings in GitHub → the suite repo → Settings → Branches → Add rule, once after the first push. The repository owner applies them; nothing in this repo applies them automatically.

- Branch name pattern: `main`
- Require a pull request before merging
- Dismiss stale pull request approvals when new commits are pushed
- Allow merge commits only. Disable squash merging and rebase merging.
- Do not allow force pushes
- Do not allow deletions
- Require status checks to pass before merging, and select the CI check (`check`, from `.github/workflows/ci.yml`)
