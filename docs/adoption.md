# Adopting Mission Control into an Organization

This is the procedure an agent follows when a person chooses "Přidat do
Organizace" for Mission Control in the Lazurio Marketplace, or asks for it in
Chat. It follows LazurioPlatform
[`docs/marketplace.md`](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/marketplace.md)
and the [Module Standard](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/module-standard.md).

The brief names three things: the **release** (tag and full commit, as the
Marketplace registry records them), the **target Organization** and the
**start**: `empty` (no plans) or `sample` (the fictional example plans of the
release).

**Nothing is merged, published, granted or started without the person's
explicit instruction.** The agent prepares pull requests and requests; every
merge, every publish of data and every access change is the person's
Publication. Where the person's rights do not reach, the agent prepares a
request for whoever may do it and goes on with the rest.

## 1. Check rights, name and compatibility

Do all of this live, before showing a plan.

1. **Who acts.** `gh api user --jq .login` is the person's login. Creating an
   Organization's Module needs an active Owner of the Organization:
   `gh api orgs/<Org>/memberships/<login> --jq .role` is `admin`. Otherwise
   prepare a request for an Owner
   (`gh api "orgs/<Org>/members?role=admin" --jq '.[].login'`): an issue in
   the Organization's root repository with the plan below, assigned to them.
2. **The release.** Compare the released commit with the brief. A release
   tag is annotated, so the tag ref itself names the tag object; the commit
   is the peeled `^{}` line:

   ```bash
   git ls-remote https://github.com/LazurioTemplates/mission-control "refs/tags/<tag>^{}"
   ```

   Its first column must be the recorded commit. A mismatch, or no `^{}`
   line, stops the adoption.
3. **Name collision.** Mission Control's slug is `mission-control`. Look in
   the Organization's `modules.manifest.json` for a slot with that slug or
   path, and on GitHub for `<Org>/mission-control` and
   `<Org>/mission-control-data`.
   - Nothing there: go on with the slug `mission-control`.
   - The Organization already runs Mission Control (a fork of
     `LazurioTemplates/mission-control`, formerly `Lazurio/mission-control`,
     3.x or an earlier release of this template):
     this is not a new adoption. Take the release into the existing Module as
     an update ([`extending.md`](extending.md), "Taking a template release")
     and tell the person.
   - An unrelated Module or repository has the name: agree another slug with
     the person (for example `planning`) and use it below for the Module and
     its `<slug>-data` repository.
4. **Compatibility.** The Organization's Environments run a LazurioPlatform
   release that knows `start_script` and `build_output` (v0.1.11 or newer);
   Bun 1.4.4 is fetched by Lazurio when missing.

## 2. Show the plan and wait for confirmation

Show the person, in their language and in a few lines:

- the release (version, tag, commit) and that its code runs in the
  Organization's Environments (`bun install`, the tests, the App);
- the two private repositories that will be created: `<Org>/<slug>` and
  `<Org>/<slug>-data`;
- the Teams that get access, chosen from the Organization's real list
  (`gh api orgs/<Org>/teams --jq '.[].slug'`), never guessed;
- the plan prefix for the Organization's plan codes (2-6 capital letters,
  for example `ACME`);
- the start: empty, or the fictional example plans in the person's
  language (Czech or English);
- the pull requests that will wait for them.

Go on only after the person confirms this plan.

## 3. Create the Module

From a task worktree of the Organization's root repository:

```bash
lazurio module create <Org>/<slug> --stack vite-react --teams <team,team> --data --dry-run
lazurio module create <Org>/<slug> --stack vite-react --teams <team,team> --data --confirm <plan>
```

This creates the private Module repository with the scaffold, the private data
repository `<slug>-data` on branch `v3`, and declares both slots in the root
worktree. The root's pull request is the person's to merge.

## 4. Merge the release into the Module

In a worktree of the new Module, on a branch:

```bash
git fetch https://github.com/LazurioTemplates/mission-control.git "refs/tags/<tag>"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "<commit>"
git merge --allow-unrelated-histories --no-ff --no-commit <commit>
```

Resolve so that the template's tree wins everywhere except the Organization's
identity, and remove the scaffold's App:

- `git rm -r app/v1` (the scaffold's App; `apps[]` lists only `app/v3`);
- `lazurio.module.json`: `id` and `company` of the Organization, the port lease
  the scaffold allocated, `apps` and `default_app` = `app/v3/package.json`;
- `app/v3/package.json` → `lazurio.runtime`: `id` `<org-lowercase>-<slug>-v3`,
  `company`, `module`;
- `app/v3/config/data-repository.json`: the `remote` of `<Org>/<slug>-data`
  exactly as `db/repository-db.yaml` names it, `branch: v3`;
- `app/v3/src/instance/brand.ts`: the Organization's display name;
- `AGENTS.md`: keep it and add a section "This Organization's copy" (who
  reviews, where its data lives);
- keep `LICENSE` and `NOTICE.md`: MIT requires the notice.

Commit the merge, then check that the release stays an ancestor; this is what
lets later releases arrive as ordinary merges:

```bash
git merge-base --is-ancestor <commit> HEAD
cd app/v3 && bun install --frozen-lockfile && bun run check && bun run build
```

Push the branch and open a pull request in the Module. Do not merge it.

## 5. Prepare the data repository

In a worktree of `<Org>/<slug>-data`, on a branch from `v3`:

- copy `templates/data-repo/` of the release: `schemas/`, `scripts/`
  (the validator and its check bundle `mission-control-check.js`),
  `.github/`, `.gitattributes`, `.gitignore`, `README.md`, `AGENTS.md` and
  `data/mission-control/`;
- in `repository-db.yaml` keep `data_repo` as `lazurio module create` wrote
  it and take `schema`, `layout`, `generated_manifest` and `validate` from the
  template;
- set `plan_prefix` in `data/mission-control/mission-control.config.json` to
  the agreed prefix;
- for the `sample` start, also copy `templates/sample-data/<language>/data/`
  in the person's language (`cs` or `en`) and replace its prefix `EX` with
  the agreed one everywhere: plan codes and references, ids
  (`mcplan-ex-` → `mcplan-<prefix>-`), file names and evidence paths;
- run `bun scripts/validate.ts` in this worktree. It runs the App's own check
  (the Zod schemas with their refinements, the rules across records and the
  App's YAML parser), so a pass here is a pass in the App; there is no need
  to point the Module's `db/` at this branch. The App can check the same
  directory with its current code: `bun run validate -- --data <this
  worktree>` in `app/v3`;
- push and open a pull request into `v3`. Its CI job `validate` runs the same
  validator; once the data repository has it, an Owner makes `validate` a
  required check of `v3` (the Organization's ruleset), as for every Module's
  data.

## 6. After the person merges

- `lazurio module start <Org>/<slug>`, then open the App by its `runtime.url`
  and check the main path: the overview, a roadmap, a plan, an edit saved as a
  draft. Publishing that draft is a Publication into the Organization's data:
  only on the person's instruction, otherwise discard it.
- **Last step: access of Teams.** Set or confirm which Teams reach the Module
  and its data the same way as for every Module, in the Organization overview
  (Přehled Organizace) of Lazurio. The Marketplace has no access list of its
  own. Change access only on the person's instruction.

## Handoff

Tell the person, with links: the root pull request (slots), the Module pull
request, the data pull request, what each waits for and who decides it, and
any request prepared for someone with more rights.
