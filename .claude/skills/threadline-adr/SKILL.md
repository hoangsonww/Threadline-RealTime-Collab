---
name: threadline-adr
description: Use when a change is an architectural decision rather than an incremental fix — a new dependency, a new data model relationship, a new trust boundary, or a reversal of an existing decision. Covers this repository's specific ADR format, which is stricter than the generic template.
---

# Writing an architecture decision record

Threadline's ADRs are not the three-line generic template. They record **what the decision cost**, not only what it bought, and they enumerate the alternatives with the actual reason each was rejected. That is what makes them useful two years later when someone proposes the rejected alternative again.

Read [`docs/decisions/0003-repository-interface.md`](../../../docs/decisions/0003-repository-interface.md) before writing one. It is the house style.

## When a change needs an ADR

- A **new dependency**. This repository is deliberately conservative about them.
- A **new data model relationship** — a new entity, or a new edge between existing ones.
- A **new trust boundary**, or the removal of one.
- **Reversing** a decision an existing ADR records.
- A change that a future contributor would reasonably propose undoing without knowing why it is the way it is.

Not every non-trivial change qualifies. A bug fix, a performance improvement inside an existing design, or a new endpoint that fits the established pattern does not need one.

## Format

File: `docs/decisions/NNNN-kebab-case-title.md`, numbered after the highest existing record. As of writing that is [0008](../../../docs/decisions/0008-recovery-codes-not-knowledge-based-reset.md), so the next is `0009-…`.

```markdown
# ADR-NNNN: <the decision, stated as a decision — not a topic>

## Status

Accepted

## Date

YYYY-MM-DD

## Context

What was true that forced a choice. The constraint, the requirement, the
incident. Written so someone with no memory of the discussion understands why
doing nothing was not an option.

## Decision

What was decided, concretely, naming the actual files and symbols. A Mermaid
diagram where the relationship is structural rather than sequential — the
existing ADRs use them and they carry real weight.

Include a worked example if the decision has an ongoing cost, the way ADR-0003
walks through `incrementRateLimit` to show the tax being paid in practice.

## Alternatives Considered

### <Alternative one>

- Pros: …
- Cons: …
- Rejected: <the specific reason, not a restatement of the cons>

### <Alternative two>

…

## Consequences

Both directions. What this makes easy, and what it makes permanently harder.
The consequences section is the part people actually return to read.
```

## Rules

- **Title states a decision.** "A `Repository` interface with in-memory and MongoDB implementations", not "Database access".
- **Alternatives get a real hearing.** "Rejected: it was worse" is not an alternative considered. Each needs the concrete reason — cost, complexity, illusory benefit — that made it lose.
- **Consequences include the costs.** ADR-0003 states plainly that every new persistence operation must be implemented twice. An ADR with only upsides in its consequences has not been thought through.
- **Dates come from git history**, not from a guess. `git log --format=%ad --date=short -1 -- <path>` for the file the decision concerns.
- **Never delete a superseded ADR.** Set its status to `Superseded by ADR-NNNN` and write a new one. The record of having changed your mind is itself the valuable part.
- **Link the code.** Relative links to the files the decision governs, so the ADR and the implementation stay findable from each other.

## After writing it

1. Add the row to the table in [`docs/decisions/README.md`](../../../docs/decisions/README.md).
2. Update the live summary table in [`docs/architecture.md`](../../../docs/architecture.md) if the decision changes it.
3. Run `npm run docs:links` — the ADR index and cross-links are exactly the kind of thing that rots.

## Checklist

- [ ] Numbered after the current highest ADR
- [ ] Title states a decision, not a topic
- [ ] Context explains why doing nothing was not an option
- [ ] Decision names actual files and symbols
- [ ] At least two alternatives, each with a specific rejection reason
- [ ] Consequences include what this makes permanently harder
- [ ] Date derived from git history
- [ ] Superseded ADRs marked, not deleted
- [ ] Row added to `docs/decisions/README.md`
- [ ] `docs/architecture.md` updated if the summary changed
- [ ] `npm run docs:links` passes
