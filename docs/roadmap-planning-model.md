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

## Approximate timing

A Roadmap Step may carry an optional `timing`: the approximate window in which it lands, in the units leaders plan in.

```yaml
timing:
  from: 2026-11       # optional: start of the work window
  to: 2027-Q1         # required inside timing: when the step should land
  confidence: likely  # optional: committed | likely | tentative
```

- A period is a calendar month `YYYY-MM` or a quarter `YYYY-Qn`; a window may mix them. Roadmaps deliberately have no day-level dates: those read as promises and go stale daily.
- `to` says when the step lands. Without `from` the step lands in that period (a launch, a release); with `from` it is a work window.
- `from` must neither start nor end after `to`, so `from: 2026-Q4` with `to: 2026-11` is rejected.
- `confidence`: `committed` can be communicated outside the Organization, `likely` is the plan the Organization works towards, `tentative` is a rough estimate. An absent value means it was not stated.
- Steps without `timing` stay valid and are listed as unscheduled. Archived steps never appear on the timeline.

Timing is the only new data. The order comes from what already exists: the period in which a step lands, then its start, then the step order in the file. There is no second ordering store, and `priority_rank` keeps ordering plans.

## Main roadmap

One roadmap in an Organization data repository may set `main: true`. Development in the Organization follows it, and it is the roadmap people see first.

- At most one roadmap sets it. The app validator and the pinned data validator reject a second one and name the file that already holds it. Moving the marker means removing it from one roadmap and adding it to the other in the same publication.
- An archived roadmap cannot be the main roadmap.
- Without a marker, the app shows the only roadmap, otherwise the roadmap in progress or the first active one, and says that no main roadmap is designated. The dry-run roadmap execution report without an explicit roadmap code also starts from the main roadmap.

The marker is a roadmap-level flag rather than a pointer in `mission-control.config.json`. It lives with the data it describes, goes through the same roadmap drafts, review and publication, and cannot point at a renamed or deleted roadmap. The config is a control-plane file the Mission Control writer does not publish. Uniqueness is a cross-document rule, enforced the same way as a duplicate `roadmap_code`.

## Leader timeline

The first sidebar entry of the app, **Hlavní roadmapa**, shows the main roadmap as a timeline for people who need to know when things arrive rather than read plan text:

- a quarter axis with a today marker; each scheduled step is a bar from `from` to `to`, coloured by its state with a written label: planned (`shaping`, `ready`), in progress (`in_progress`, `review`), blocked, done; committed timing has an outline, tentative timing is dashed;
- a summary of done steps out of all steps, steps in progress, blocked steps, and the next planned step in time order;
- every step expands to its acceptance criteria, the linked plans (they open in the app), the pull requests and GitHub issues of those plans (`github.prs`, issue URLs in plan `links`), historical `issue_refs` and evidence;
- on a phone the axis becomes a list grouped by the quarter in which each step lands.

The next planned step on the timeline is a reading aid for people. The agent loop's next runnable step on the Roadmaps page keeps its existing rules.

## Adoption in an Organization

An Organization data repository validates with its own copies of `schemas/mission-control-roadmap.schema.json` and `scripts/validate-mission-control-data.mjs`, and the app reads the roadmap schema from the data repository too. Until those copies are updated, `timing` and `main` are rejected as unknown fields, while existing roadmaps keep validating and the timeline lists their steps as unscheduled.

To adopt the fields:

1. Integrate the first `Lazurio/mission-control` release that carries the fields (see `CHANGELOG.md`) into the Organization's `mission-control` app code, as "Downstream synchronization" in `README.md` describes.
2. In one data pull request on `v3`, copy both files from the synchronized app code (`templates/organization-data/`) into the data repository, mark the main roadmap with `main: true` and add `timing` to the steps that leaders should see on the timeline.

App and data have to move together. Once a client runs the updated app, it rejects an inbound update whose roadmap schema is still the old one. A client still on the old app cannot import data that already uses the new schema. Update every app client of the Organization (each checkout of its Mission Control that people or its automated Environments run) and publish the data pull request in one announced, short window. Until both sides match, the clients concerned refuse those updates.

## Repository boundary

`schemas/mission-control-roadmap.schema.json` is the structural model. Organization-aware validation (existence of referenced plans, TODO rows, issue rows, and tracked evidence paths) belongs in the consuming Organization checkout where the concrete data exists.

The template check still protects the model from drift: it verifies that priorities, executable step refs, done-step evidence, the optional step timing and main roadmap marker, and repository-db roadmap schema wiring remain present, and that the Organization data copy of the roadmap schema stays identical to the app/code schema.

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
