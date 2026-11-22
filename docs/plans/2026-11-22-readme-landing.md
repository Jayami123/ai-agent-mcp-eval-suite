# Plan: README as a landing page, run instructions in docs/running.md

Date: 2026-11-22. Branch: `docs/2026-11-22-readme-landing`, from `main` at `98cd94d`. The owner waived a separate plan PR, so this plan is the first commit of the draft PR, and the build follows in the same PR.

## Scope

1. Replace `README.md` with the landing page the owner supplied. Each `{…}` slot is filled from the repository, and the command or file behind each number is listed in the PR body. A slot that cannot be backed is cut from its sentence, and the cut is reported.
2. Move the technical content of the current README (install and run, stub vs nightly, stack tests, recorded deviations) to `docs/running.md`, unchanged except for relative links, and link it from the README.
3. Check each "What it found" bullet against its findings doc and its `expectedDefect` summary. A bullet that does not match its source is corrected to match, and the change is reported.

## Slot sources

- `N_DEFECTS`: distinct findings. A finding is one F-ID row of `docs/findings/l4-openclaw.md` ("Product behaviour recorded as `expectedDefect`"), or one distinct `expectedDefect` summary in `tests/l3/`. A summary used at several call sites counts once.
- `N_PRODUCTS`: the distinct products those findings sit in. The suite's attack lab is not a product and is not counted.
- `N_CASES`: the L3 catalogue (`tests/l3/support/l3-cases.json`) plus the L4 set (`tests/l4/ledger.test.ts`, 62 IDs).
- `N_JOBS`: the jobs of a PR CI run on `main` (jobs API).
- `K_TRIALS`: the `measured_k` default in `.github/workflows/nightly.yml`.

## Bullets to check

- "An assistant that sends messages to anyone": F-L4-2.
- "Memory shared between users": F-L4-4 (`tests/l4/mem/p4-oc-mem-006`, `p4-oc-mem-003`).
- "A design-tool sandbox that reaches the network": Penpot (`tests/l3/penpot/`).
- "A file tool that escapes its folder": the Nextcloud TOOL-008 summary.
- "Further findings in two products are being reported privately": no source in the repository says this. The repository mentions private advisory fixtures only (`P4_PRIVATE_FIXTURES_DIR`). The bullet is cut and reported.

## Verification

- `npm run check`, output read.
- Push the draft PR head and watch CI to completion. Report the run id and result. The PR is not marked ready.
