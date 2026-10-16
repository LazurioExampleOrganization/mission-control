# v3 Module Documentation Standard

Every reusable Lazurio GEN3 module should be understandable by a client, an internal steward, and an external AI agent without reading private implementation chats.

This document defines the minimum documentation set for reusable v3 modules. Mission Control v3 is the first full implementation of this pattern.

## Goals

A v3 module documentation set must answer:

1. What does this module do for an Organization?
2. Which repository owns reusable app/code?
3. Which repository or directory owns Organization data?
4. What is the intended operating mode inside a Lazurio Workspace?
5. Which files are source of truth and which are generated or compatibility fallback?
6. How does Doctor install, verify, or mount it?
7. How does Launchpad expose it to users?
8. How do humans and AI agents safely extend it?
9. What must never be committed?
10. What validation proves a change is safe?

## Required files

| File | Purpose |
|---|---|
| `README.md` | Short purpose, boundaries, quickstart, validation commands, rollout references. |
| `LICENSE` | Client rights. MIT is acceptable for modules intended to be commercially extended by clients. |
| `CONTRIBUTING.md` | How contributors change app/code without mixing Organization data. |
| `SECURITY.md` | Secret-handling and vulnerability reporting policy. |
| `docs/<module>-v3-operating-manual.md` | Full architecture, ideology, operation, administration and extension manual. |
| `docs/doctor-managed-install.md` | Doctor/Launchpad install and mount contract. |
| `docs/repository-db-data-boundary.md` | Required when module data is Organization-owned or write-gated. |
| `docs/<domain-model>.md` | Domain-specific model docs: roadmap planning, deals, pricebook, knowledgebase, etc. |

## Operating manual sections

Each module operating manual should include:

1. **What it is** — the module's role in the Workspace.
2. **Product ideology** — why the module exists and what it optimizes for.
3. **Lazurio delivery model** — how Lazurio provides it to client Organizations.
4. **Repository architecture** — app/code, data, generated outputs, compatibility fallback.
5. **Runtime architecture** — UI/API/CLI/server/adapter layers.
6. **Data model** — canonical records, ledgers, schemas and evidence.
7. **Write and approval model** — who can change what and through which gate.
8. **Doctor and Launchpad integration** — installation, health checks, app discovery.
9. **Operating modes** — compatibility, hybrid, data-repo or module-specific equivalents.
10. **Administration checklist** — commands and human checks.
11. **Extension guide** — how to add fields, UI, adapters or integrations safely.
12. **Why this architecture exists** — tradeoffs and rationale.
13. **What not to do** — explicit anti-patterns.
14. **Related docs** — local docs and Organization rollout references.

## Validation expectation

The module should have a check command that makes the critical documentation part of the repository contract. At minimum it should verify:

- required docs exist;
- license exists and matches the intended client-rights model;
- README links the operating manual;
- security/secret policy is present;
- repository-db or data-boundary docs are present when data lives outside app/code;
- no obvious secret markers are present in required docs/templates.

## Client-rights policy

For modules intended to be delivered into client-owned commercial Workspaces, default to a permissive license unless a future business/legal decision says otherwise. MIT keeps the important promise: clients may use, copy, modify, merge, publish, distribute, sublicense, and sell their derived version while keeping copyright and permission notices.

If a module includes third-party dependencies with stricter obligations, document them in the README or a future `NOTICE` file.

## Agent-facing writing style

Write docs so that an AI agent can act safely:

- name exact files and commands;
- separate reusable template truth from Organization truth;
- say which operations require admin/steward approval;
- include validation commands;
- state non-goals and forbidden actions;
- avoid vague phrases like “update the config” without naming the config path;
- keep examples generic unless they live in an Organization-local repo.
