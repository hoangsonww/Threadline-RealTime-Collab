# ADR-0008: Recovery codes for account recovery, not knowledge-based reset

## Status

Accepted

## Date

2026-08-14

## Context

[ADR-0007](0007-no-email-verification-without-a-mail-provider.md) removed email verification because Threadline has no
transactional email provider. That left password recovery as the only remaining feature depending on mail, and it had
the same silent failure: `POST /v1/auth/password-reset/request` wrote a token, answered `202 Accepted`, and delivered
nothing. Unlike verification, recovery could not simply be deleted — removing it would leave a locked-out account with
no route back in at all.

The obvious replacement, and the one initially requested, was a knowledge-based reset: the person enters their email
plus a few more account details, the server confirms they match, and the password is reset.

**That design is unsafe in this system specifically.** `publicUser` returns `id`, `email`, `username`, `displayName`,
`createdAt`, and `updatedAt`, and it is what `GET /v1/orgs/:orgId/members` and the room member endpoints return to
**every member of the organization**. Any recovery check built on those fields would be satisfiable by data the API
hands a caller on request. Concretely: any member of a workspace could take over any other member's account, including
an owner's, by reading the member directory. The API would be publishing the credentials to its own recovery flow.

## Decision

Recover accounts by proving **possession of a secret**, not knowledge of a fact.

1. Registration issues **eight single-use recovery codes** and returns them in the `201` response — the only moment the
   plaintext exists. Twelve symbols from a 31-character unambiguous alphabet is ~59 bits.
2. Only `digest(normalizeRecoveryCode(code))` is persisted. Normalization strips case and separators, so how someone
   types a code back does not matter, but nothing stored can be reversed into a usable code.
3. `POST /v1/auth/password-reset/redeem` takes `{ email, code, password }`. It consumes the code with an atomic
   `findOneAndUpdate` on `usedAt: { $exists: false }`, rehashes the password, and **revokes every session for the
   account** — a reset that leaves the intruder logged in has not reset anything.
4. A wrong code and an unregistered email return byte-identical responses. The endpoint is rate limited 10/15min/IP.
5. `POST /v1/auth/recovery-codes` regenerates the set, invalidating every previous code. `GET` returns counts only.
6. The web UI shows codes exactly once, with copy and download, behind an explicit "I have saved these" acknowledgement
   rather than a button that can be clicked past.

The mailed `password-reset/request` / `confirm` pair is kept for deployments that do configure `AUTH_DELIVERY_WEBHOOK`.
It is now a convenience rather than the only route back in.

## Alternatives considered

**Knowledge-based reset on account facts.** Rejected for the reason above: the facts are published to the account
holder's own colleagues. This is not a general objection to KBA — it is that *these particular fields* are readable by
exactly the people best positioned to abuse them.

**Security questions.** Better than published facts, but answers are low-entropy, frequently guessable from public
information, and users reuse them across services. A generated code is strictly stronger for the same amount of UI.

**Owner-issued reset tokens.** Considered and deliberately deferred rather than rejected. It solves the "lost my codes"
case, but it hands every workspace owner the ability to take over any member account — a real capability that deserves
its own decision, and it does nothing for the first owner or a solo account, who have no one above them.

**Add a mail provider.** Still the right long-term answer for reset links, notifications, and invitations. It is an
account, a domain, SPF/DKIM records, deliverability monitoring, and a recurring cost — worth doing deliberately, not
smuggled in under a recovery fix.

## Consequences

- Account recovery works in a deployment with no email infrastructure at all, which is the deployment that actually
  exists.
- **A lost set of codes is a lost account.** There is no side channel, and that absence is what makes the codes worth
  trusting. Regenerating from Settings is the mitigation; the acknowledgement gate at sign-up is the nudge.
- Registration responses now contain secrets. They were already `Set-Cookie` responses carrying a session token, so this
  does not change how carefully that response must be handled, but it is worth knowing before anyone logs response
  bodies.
- Support gains a question it cannot answer — "I lost my codes" — and that is the intended trade rather than an
  oversight.
- The `users.username` unique index landed alongside this work, so username collisions are now settled by the database
  rather than by a read-before-write. See [`../roadmap.md`](../roadmap.md) for the duplicate-backfill caveat on
  pre-existing deployments.
