# Mission Control roadmap planning model

This template owns the reusable **model**, not Organization roadmap content. Each Organization stores concrete roadmap files in its own `mission-control-data` repository.

## Core records

- **Roadmap** — a long-lived planning surface identified by `RM-XXXX`. It groups priorities and executable steps around a reusable or Organization-local outcome.
- **Roadmap Priority** — a ranked reason for why this roadmap matters. Priorities use stable `priority-###` IDs so Roadmap Steps can reference them without depending on order.
- **Roadmap Step** — a bite-sized unit of roadmap execution identified by `step-###`. A step can be shaping, ready, in progress, review, blocked, done, or archived.

## Execution gates

A Roadmap Step must declare `executable: true` or `false` explicitly.

Executable Roadmap Steps must point at at least one actionable source:

- `plan_refs` — Mission Control plans such as `DEV-0001` or `ACME-0023`.
- `todo_refs` — materialized TODO ledger rows.
- `issue_refs` — legacy issue identities retained for historical references. New active issues belong in owning GitHub repositories; link their URLs in the plan.

Done Roadmap Steps must include `evidence_refs`, with either a repository-relative `path` or an external `url` plus `verification: external`.

## Repository boundary

`schemas/mission-control-roadmap.schema.json` is the structural model. Organization-aware validation (existence of referenced plans, TODO rows, issue rows, and tracked evidence paths) belongs in the consuming Organization checkout where the concrete data exists.

The template check still protects the model from drift: it verifies that priorities, executable step refs, done-step evidence, and repository-db roadmap schema wiring remain present.

## Intent before implementation

Plans outline the problem, intended outcomes, milestones and fixed boundaries.
Distinguish required mechanisms from flexible implementation details and work
that may be trimmed or deferred. Materialize the next useful tasks; avoid
turning distant milestones into a speculative implementation checklist.

Before a behavior, interface or architecture change, define a small executable
contract in the owning code repository. Exercise a real consumer, the promised
outcome and important failure cases. Demonstrate the expected failure before
implementation and success afterward. Refactors preserve these contracts.

This is a review default with explained exceptions for documentation, cosmetics
and bounded discovery spikes. No test-count quota, mandatory separate red PR or
blanket machine gate is required. Link the contract and evidence from the PR;
Mission Control owns intent, not a duplicate copy of the tests.

When direction changes, explain and update the intent and contract before code.
The Principal decides changes to fixed business/access/publication boundaries.
Replace tests that endorse incorrect behavior or constrain irrelevant internals;
never weaken a contract solely to accommodate existing implementation.
