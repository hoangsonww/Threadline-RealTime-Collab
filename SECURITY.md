# Security policy

Threadline is three independently deployable services that deliberately do not trust each other's enforcement. That design is the subject of [`docs/security.md`](docs/security.md), which documents the secrets inventory, the trust model, and every boundary where a check is re-performed rather than inherited. This file covers only the process: how to report something, what happens next, and what is in scope.

## Table of contents

- [Reporting a vulnerability](#reporting-a-vulnerability)
- [What to include](#what-to-include)
- [What happens next](#what-happens-next)
- [Scope](#scope)
- [Out of scope](#out-of-scope)
- [Supported versions](#supported-versions)
- [Safe harbor](#safe-harbor)
- [Where the security-relevant code lives](#where-the-security-relevant-code-lives)

## Reporting a vulnerability

**Do not open a public issue.** A public issue for an exploitable bug is a disclosure, not a report.

Report privately through GitHub's private vulnerability reporting:

**[→ Open a security advisory](https://github.com/hoangsonww/Threadline-RealTime-Collab/security/advisories/new)**

That channel is private to you and the maintainer until an advisory is published. There is no public bug-bounty program for this project and no monetary reward — reports are accepted and credited on their merits.

If the advisory form is unavailable to you for any reason, contact the repository owner directly through their GitHub profile and ask for a private channel before sending details.

## What to include

A report that can be reproduced is worth substantially more than one that has to be inferred. Where you can, include:

- **Which service.** `apps/api` (Express identity and persistence tier), `apps/realtime` (Cloudflare Worker and Durable Object), or `apps/web` (Next.js frontend). "Not sure" is fine.
- **The trust boundary crossed.** Threadline's boundaries are enumerated in [`docs/security.md`](docs/security.md) — a report is far easier to act on when it names the check that should have stopped it.
- **Reproduction steps**, ideally against a local `npm run dev` or `npm run docker:up` stack rather than a hosted deployment.
- **Impact.** What does an attacker get? Reading another workspace's room events is a different severity from crashing a single Durable Object.
- **The commit** you tested (`git rev-parse HEAD`).
- Any proof-of-concept, with credentials and tokens redacted.

## What happens next

| Stage | Target |
| --- | --- |
| Acknowledgement that the report was received | within 72 hours |
| Initial assessment — reproduced or not, provisional severity | within 7 days |
| Fix, or a written explanation of why it will not be fixed | within 90 days of the assessment |
| Public advisory published, reporter credited unless they decline | after the fix ships |

This is a personal project maintained outside of business hours; these are honest targets rather than a contractual SLA. If a target slips, you will get an update rather than silence.

Please give the maintainer a reasonable window to ship a fix before disclosing publicly. If you intend to disclose on a fixed date regardless, say so in your first message so the timeline can be planned around it rather than discovered.

## Scope

In scope — anything that breaks the guarantees the architecture claims to make:

- **Authorization bypass.** Reading, writing, or joining a room or organization resource without the ABAC decision in [`apps/api/src/policy.ts`](apps/api/src/policy.ts) permitting it.
- **Cross-tenant leakage.** Any path where one workspace or room observes another's data, including through the realtime tier.
- **Room ticket forgery.** Minting, replaying, or extending a room ticket that `apps/realtime` will accept.
- **Internal ingest forgery.** Getting `apps/api` to accept persisted room events that did not originate from an authorized realtime instance.
- **Authentication flaws.** Session fixation, token or cookie handling, the OIDC/OAuth surfaces, password reset, and the recovery-code flow ([ADR 0008](docs/decisions/0008-recovery-codes-not-knowledge-based-reset.md)).
- **Secret exposure.** Any secret from the [secrets inventory](docs/security.md#secrets-inventory) reachable from the browser, a `NEXT_PUBLIC_*` variable, a log line, or an error response.
- **Injection and deserialization** in any service, including the realtime message protocol.
- **Stored or reflected XSS** in `apps/web`, and any CSP bypass.
- **SSRF** through the TURN credential surface or any server-side fetch.
- **Container and manifest defaults** in `infra/` or the Dockerfiles that are insecure as shipped.

## Out of scope

- Denial of service through raw volume, and any load or stress testing against a hosted deployment.
- Findings from automated scanners with no demonstrated exploit path — an unreviewed tool report is not a vulnerability report.
- Vulnerabilities in a dependency with no demonstrated reachable path in this codebase. Dependency updates are handled by Dependabot; file a normal issue instead.
- Missing hardening headers or best-practice deviations with no attacker-observable consequence.
- Social engineering, physical attacks, or anything targeting the maintainer rather than the software.
- Self-inflicted configuration: secrets committed by an operator, a deployment run with `COOKIE_SECURE=false` outside local development, or the development placeholder secrets in `compose.yaml`, which are labeled `change-me` precisely because they are not secrets.
- Anything requiring an already-compromised account or host, unless it enables privilege escalation across a trust boundary.

## Supported versions

Threadline is developed on `main` and deployed continuously. There are no released version branches and no backports.

| Version | Supported |
| --- | --- |
| `main` (latest commit) | ✅ |
| Any earlier commit or fork | ❌ |

Fixes land on `main`. If you run a fork, rebase.

## Safe harbor

Research conducted in good faith under this policy is authorized, and no legal action will be pursued for it — provided you:

- test only against your own local or self-hosted instance, never against another user's data on a hosted deployment;
- stop at the point where you have demonstrated the issue, and do not access, modify, exfiltrate, or retain data belonging to anyone else;
- do not degrade service for others; and
- report privately and give the disclosure window above a chance to run.

If you are unsure whether a piece of testing is authorized, ask first through the advisory channel.

## Where the security-relevant code lives

These paths are owned in [`.github/CODEOWNERS`](.github/CODEOWNERS) specifically because a change to any of them is never "just a refactor":

| Path | What it enforces |
| --- | --- |
| [`apps/api/src/policy.ts`](apps/api/src/policy.ts) | Every ABAC decision — `canRoom` and `canOrganization` |
| [`apps/api/src/security.ts`](apps/api/src/security.ts) | Sessions, tokens, hashing, and the ticket-signing primitives |
| [`apps/api/src/turn.ts`](apps/api/src/turn.ts) | Time-boxed TURN credential derivation |
| [`apps/realtime/src/index.ts`](apps/realtime/src/index.ts) | Independent ticket verification at the realtime boundary |
| [`docs/security.md`](docs/security.md) | The written trust model those files implement |

A report that names one of these files and the specific line whose assumption is wrong is the most actionable kind there is.
