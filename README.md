# AI agents with real tools, tested like production software

ISTQB-certified QA engineer, 4 years in manual and automated testing. Open to remote QA roles and contract work.

AI agents now read your files, send your mail and edit your designs. This project checks what they actually do with that access, not what they say they did.

It drives two real agent products (OpenClaw, a personal assistant on a chat channel, and LibreChat, a multi-user chat app) against five real self-hosted tools through MCP, the standard way agents plug into tools: Nextcloud, Outline, Twenty CRM, Penpot and Mattermost. Every test that changes something ends by reading the product's real state, such as the mailbox, the database or the design file, so a pass means the thing happened, or provably didn't.

## What it found

- **20 product behaviours pinned as known defects** across 5 products. Each test fails the day the product fixes the behaviour, so the record never goes stale.
- **An assistant that sends messages to anyone.** OpenClaw's message tool delivered to chats nobody allowed, with no approval step.
- **Memory shared between users.** A fact one user told the assistant could be recalled by another, and a non-owner could overwrite the owner's memory.
- **A design-tool sandbox that reaches the network.** Code the agent ran inside Penpot could call a host it was meant to be cut off from.
- **A file tool that escapes its folder.** Nextcloud's MCP server refused `..` paths but read a sibling folder through an absolute path.

## What it covers

- **164 test scenarios** across prompt injection, approval gates, tool permissions, multi-user isolation, OAuth, protocol conformance, memory and reliability.
- **32 CI jobs on every pull request.** Thirty start Docker services, the real products or the suite's attack lab, and use a scripted model where a model is needed. Two run the unit checks on Node 22 and 24.
- **A nightly run against a real model** (DeepSeek), 10 trials per measured case, with provider outages reported as inconclusive rather than counted as passes.
- **Honest gaps.** Where a case can't run yet, it's a named skip with the reason and a pointer to the evidence, never a silent pass.

## How it works

A shared harness ([qa-portfolio-harness](https://github.com/Jayami123/qa-portfolio-harness)) starts and seeds the products at pinned versions. A recorder sits between the agent and each tool and logs every call. Tests compare three things: what the model asked for, what reached the tool, and what changed in the product. Findings and every decision behind them are written up in [`docs/findings/`](docs/findings/).

How to run it: [`docs/running.md`](docs/running.md).

## Contact

Jayami Hettigoda: [LinkedIn](https://www.linkedin.com/in/jayamihettigoda/)
