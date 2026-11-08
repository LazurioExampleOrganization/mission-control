import type { Priority, Status } from "../domain/common.ts";
import type { CONFIDENCES } from "../domain/roadmap.ts";
import type { RuleIssueCode } from "../domain/rules.ts";
import { plural } from "./format.ts";
import type { Locale } from "./locale.ts";

/**
 * Every text the App shows a person, in Czech and English. The Czech catalog
 * defines the keys; TypeScript holds the English one to exactly the same
 * shape, so no screen can fall back to the other language. Codes, names and
 * the Organization's own records are never translated.
 */
type Params = Record<string, string>;
type Confidence = (typeof CONFIDENCES)[number];

const csSchemaKind: Record<string, string> & { other: string } = {
  invalid_type: "chybí nebo má špatný typ.",
  too_small: "je prázdné nebo příliš krátké.",
  too_big: "je příliš dlouhé.",
  invalid_format: "nemá správný tvar.",
  invalid_value: "má nepovolenou hodnotu.",
  unrecognized_keys: "obsahuje neznámé pole.",
  invalid_union: "neodpovídá žádné povolené podobě.",
  other: "neodpovídá schématu.",
};

const csSchemaRule: Record<string, string> = {
  executable_step_refs: "spustitelný krok musí odkazovat na plán, úkol nebo issue.",
  done_step_evidence: "hotový krok musí uvést důkaz (evidence_refs).",
};

const enSchemaKind: Record<string, string> & { other: string } = {
  invalid_type: "is missing or has the wrong type.",
  too_small: "is empty or too short.",
  too_big: "is too long.",
  invalid_format: "does not have the expected form.",
  invalid_value: "has a value that is not allowed.",
  unrecognized_keys: "holds an unknown field.",
  invalid_union: "matches none of the allowed shapes.",
  other: "does not match the schema.",
};

const enSchemaRule: Record<string, string> = {
  executable_step_refs: "an executable step names at least one plan, task or issue.",
  done_step_evidence: "a done step names its evidence (evidence_refs).",
};

/** The issue of a record that does not match its schema, worded from its Zod issue. */
function schemaText(
  kinds: Record<string, string> & { other: string },
  rules: Record<string, string>,
  record: string,
  field: string,
) {
  return (p: Params) => {
    const what = (p.rule ? rules[p.rule] : undefined) ?? kinds[p.kind ?? ""] ?? kinds.other;
    return p.path && p.path !== "(record)" ? `${field} ${p.path}: ${what}` : `${record}: ${what}`;
  };
}

const cs = {
  app: {
    loading: "Načítám…",
    loadFailed: "Data se nepodařilo načíst.",
    notFoundTitle: "Stránka neexistuje",
    backToOverview: "Zpět na přehled",
  },
  nav: {
    label: "Hlavní navigace",
    overview: "Přehled",
    roadmaps: "Roadmapy",
    plans: "Plány",
    newPlan: "Nový plán",
    draft: "Koncept a publikace",
    draftBadge: "Nepublikované změny",
    organizationPlaceholder: "Vaše Organizace",
  },
  status: {
    shaping: "Tvarování",
    ready: "Připraveno",
    in_progress: "Rozpracováno",
    review: "Kontrola",
    blocked: "Blokováno",
    done: "Hotovo",
    archived: "Archiv",
  } satisfies Record<Status, string>,
  priority: {
    urgent: "Naléhavá",
    high: "Vysoká",
    medium: "Střední",
    low: "Nízká",
  } satisfies Record<Priority, string>,
  confidence: {
    committed: "závazně",
    likely: "pravděpodobně",
    tentative: "předběžně",
  } satisfies Record<Confidence, string>,
  progress: {
    title: (done: number, total: number) => `${done} z ${total} kroků hotovo`,
    label: (done: number, total: number) => `${done}/${total} hotovo`,
  },
  intro: {
    lead: "Mission Control je místo, kde Organizace plánuje práci lidí a agentů: co se dělá a proč, v jakém pořadí, kdo na tom pracuje a jak se změny dostanou ke všem.",
    items: [
      {
        title: "Plány",
        text: "Každý plán má cíl, rozsah a kritéria přijetí, podle kterých poznáte, že je hotovo.",
      },
      {
        title: "Roadmapy",
        text: "Řadí plány do kroků v čase a ukazují, co může začít teď.",
      },
      {
        title: "Kdo na čem pracuje",
        text: "Plán má vlastníka, úkoly mají řešitele a roadmapa říká, kteří agenti práci dělají a kdo ji kontroluje.",
      },
      {
        title: "Koncept a publikace",
        text: "Každá úprava je nejdřív koncept. Publikací ji pošlete ostatním jako jednu změnu.",
      },
    ],
  },
  overview: {
    title: "Přehled",
    subtitle: (plans: number, roadmaps: number, prefix: string) =>
      `${plural("cs", plans, { one: "plán", few: "plány", other: "plánů" })} a ${plural("cs", roadmaps, { one: "roadmapa", few: "roadmapy", other: "roadmap" })} · kódy plánů začínají ${prefix}`,
    mainRoadmap: "Hlavní roadmapa",
    roadmap: "Roadmapa",
    nextSteps: "Další kroky",
    noNextStep: "Žádný krok teď nečeká na start.",
    until: (period: string) => `do ${period}`,
    noRoadmapTitle: "Zatím žádná roadmapa",
    noRoadmapText:
      "Roadmapa seřadí plány do kroků v čase. Až budete mít první plány, požádejte agenta v Chatu, ať z nich roadmapu připraví.",
    activePlans: "Rozpracované plány",
    nothingActive: "Nic není rozpracované.",
    firstPlanTitle: "Začněte prvním plánem",
    firstPlanText:
      "Popište, co chcete změnit, pro koho a podle čeho poznáte, že je hotovo. Plán založíte tady, nebo ho v Chatu připraví agent.",
  },
  plans: {
    title: "Plány",
    subtitle: "Seřazené podle pořadí a kódu.",
    filterLabel: "Filtr stavu",
    all: "Všechny",
    noneInState: "V tomto stavu není žádný plán.",
    none: "Zatím tu není žádný plán.",
    columns: {
      code: "Kód",
      title: "Název",
      status: "Stav",
      priority: "Priorita",
      owner: "Vlastník",
      updated: "Upraveno",
    },
  },
  plan: {
    notFound: (code: string) => `Plán ${code} neexistuje`,
    back: "Zpět na plány",
    edit: "Upravit",
    rank: (rank: number) => `Pořadí ${rank}`,
    owner: (owner: string) => `Vlastník ${owner}`,
    dates: (created: string, updated: string) => `Založeno ${created} · upraveno ${updated}`,
    context: "Kontext",
    currentProblem: "Současný problém",
    targetState: "Cílový stav",
    scope: "Rozsah",
    scopeIn: "Patří do něj",
    scopeOut: "Nepatří do něj",
    acceptanceCriteria: "Kritéria přijetí",
    validation: "Ověření",
    proposedTasks: "Navržené úkoly",
    assignee: (who: string) => `Řeší ${who}`,
    onRoadmaps: "Na roadmapách",
    decisions: "Rozhodnutí",
    openQuestions: "Otevřené otázky",
    risks: "Rizika",
    links: "Odkazy",
  },
  edit: {
    breadcrumb: "Úprava",
    title: "Upravit plán",
    subtitle: "Uložení vytvoří koncept. Ostatní ho uvidí až po publikování.",
    titleField: "Název",
    status: "Stav",
    priority: "Priorita",
    rank: "Pořadí",
    owner: "Vlastník",
    scopeIn: "Rozsah: patří do něj",
    scopeOut: "Rozsah: nepatří do něj",
    onePerLine: "Jedna položka na řádek.",
    save: "Uložit do konceptu",
    saving: "Ukládám…",
    cancel: "Zrušit",
  },
  newPlan: {
    title: "Nový plán",
    subtitle:
      "Plán říká, proč se něco dělá, pro koho a podle čeho poznáte, že je hotovo. Uloží se jako koncept.",
    validationHint: "Jak se ověří, že plán splnil cíl. Jedna položka na řádek.",
    create: "Založit plán",
    creating: "Zakládám…",
  },
  roadmaps: {
    title: "Roadmapy",
    subtitle: "Roadmapa řadí plány do kroků v čase.",
    none: "Zatím tu není žádná roadmapa. Požádejte agenta v Chatu, ať ji z plánů připraví.",
    main: "Hlavní",
  },
  roadmap: {
    notFound: (code: string) => `Roadmapa ${code} neexistuje`,
    back: "Zpět na roadmapy",
    owner: (owner: string) => `Vlastník ${owner}`,
    sourcePlan: "Zdrojový plán",
    priorities: "Priority",
    noTiming: "Bez termínu",
    lane: "Kdo na roadmapě pracuje",
    laneAgents: "Práci dělají",
    laneReviewers: "Kontrolují",
    laneEscalation: "Když se krok zasekne",
  },
  draftPage: {
    title: "Koncept a publikace",
    subtitle:
      "Uložené úpravy jsou koncept. Publikováním je jedním krokem odešlete do dat Organizace, kde je uvidí ostatní.",
    check: "Kontrola dat",
    checkUnavailable: "Kontrolu teď nejde spustit.",
    checkOk: "Všechny záznamy odpovídají schématům a pravidlům.",
  },
  draft: {
    label: "Rozpracované změny a publikace",
    pill: {
      published: "Publikováno",
      draft: "Rozpracováno",
      sending: "Čeká na odeslání",
      remote: "Novější data",
      conflict: "Konflikt",
      unavailable: "Data nejsou dostupná",
    },
    headline: {
      published: "Všechno je publikované. Nic nečeká na odeslání.",
      draft: (count: number) =>
        count === 1
          ? "Jedna rozpracovaná změna čeká na publikaci."
          : `${count} rozpracovaných změn čeká na publikaci.`,
      sending: (count: number) =>
        count > 0
          ? `Publikace ${count === 1 ? "jedné změny" : `${count} změn`} je uložená, ale nedorazila na server. Zbývá dokončit odeslání.`
          : "Publikace je uložená, ale nedorazila na server. Zbývá dokončit odeslání.",
      remote: "Kolega publikoval novější data.",
      conflict:
        "Data se rozešla se serverem. Změny zůstávají vidět, ale publikovat ani vracet teď nejde.",
      unavailable: "Data zatím nejsou k dispozici.",
    },
    wholeDraft: "Publikuje se celý rozpracovaný obsah najednou — i změny, které přidal někdo jiný.",
    waitingForConflict: (count: number) =>
      count === 1
        ? "1 další záznam čeká na vyřešení tohoto konfliktu; není to další konflikt."
        : `${count} dalších záznamů čeká na vyřešení tohoto konfliktu; nejsou to další konflikty.`,
    owner: (actor: string) => `Rozpracované změny začal: ${actor}`,
    details: "Podrobnosti pro vyřešení",
    action: {
      publish: "Publikovat vše",
      discard_draft: "Zahodit vše",
      finish_send: "Dokončit odeslání",
      retry_send: "Zkusit bezpečně sloučit a odeslat",
      pull: "Stáhnout novější data",
      pull_remote: "Stáhnout",
      abort_conflict: "Zrušit odeslání, změny nechat rozpracované",
      mark_conflict_resolved: "Označit za vyřešené",
    },
    reason: {
      resolveConflictFirst: "Nejdřív je potřeba vyřešit konflikt.",
      pendingUnknown: "Chybí informace o čekající publikaci. Obnovte přehled.",
      alreadySaved:
        "Publikace už je uložená. Nejdřív ji dokončete; vracet ji zpět není totéž co zahodit rozpracované změny.",
      finishSendFirst:
        "Nejdřív dokončete odeslání uložené publikace; do té doby není poslední publikovaná verze tady.",
      unsupported: "Tuto akci aplikace zatím nepodporuje.",
      publishBlocked: "Publikovat teď nejde; důvod je v technickém detailu.",
      pullBlocked:
        "Kolega změnil stejný záznam, který upravujete. Vraťte ho, stáhněte a upravte znovu.",
    },
    change: {
      created: "Nový",
      modified: "Upraveno",
      deleted: "Smazáno",
      unknown: "Změna",
    },
    origin: {
      title: "Odkud změna přišla",
      app: "V aplikaci",
      agent: "Agent",
      unknown: "Neznámý původ",
    },
    open: "Otevřít",
    revert: "Vrátit změnu",
    technical: "Technický detail",
    hideTechnical: "Skrýt detail",
    revertBlocked: {
      conflict: "Během konfliktu nejde nic vracet.",
      sending: "Nejdřív dokončete odeslání uložené publikace.",
      other: "Tento záznam nejde vrátit samostatně.",
    },
    confirm: {
      revert: (label: string) => `Vrátit změnu záznamu "${label}" na publikovanou verzi?`,
      discardAll: (count: number) =>
        `Zahodit všechny rozpracované změny (${count})? Vrátí se poslední publikovaná verze.`,
    },
    done: {
      published: "Publikováno.",
      reverted: (label: string) => `Změna záznamu "${label}" byla vrácena.`,
      discarded: "Rozpracované změny byly zahozené.",
      sent: "Odesláno.",
      merged: "Bezpečné sloučení proběhlo a odeslání je hotové.",
      pulled: "Staženo.",
    },
    draftChanged:
      "Mezitím se rozpracované změny změnily. Nic jsme neprovedli — zkontrolujte je znovu.",
  },
  review: {
    type: { plan: "Plán", roadmap: "Roadmapa", config: "Nastavení" },
    configLabel: "Nastavení Mission Control",
    open: "Otevřít",
    created: "Nový záznam",
    deleted: "Smazaný záznam",
    changed: (count: number) => `Změněno polí: ${count}`,
    items: (count: number) =>
      plural("cs", count, { one: "položka", few: "položky", other: "položek" }),
    fields: (count: number) => plural("cs", count, { one: "pole", few: "pole", other: "polí" }),
    yes: "ano",
    no: "ne",
    field: {
      title: "Název",
      status: "Stav",
      owner: "Vlastník",
      priority: "Priorita",
      priority_rank: "Pořadí",
      updated_at: "Upraveno",
      context: "Kontext",
      current_problem: "Současný problém",
      target_state: "Cílový stav",
      scope: "Rozsah",
      "scope/in": "Rozsah: patří do něj",
      "scope/out": "Rozsah: nepatří do něj",
      acceptance_criteria: "Kritéria přijetí",
      validation: "Ověření",
      open_questions: "Otevřené otázky",
      decisions: "Rozhodnutí",
      risk_notes: "Rizika",
      proposed_tasks: "Navržené úkoly",
      summary: "Shrnutí",
      steps: "Kroky",
      priorities: "Priority",
      main: "Hlavní roadmapa",
      agent_lane: "Kdo na roadmapě pracuje",
      plan_prefix: "Prefix plánů",
    } as Record<string, string>,
  },
  errors: {
    codes: {
      record_changed:
        "Záznam mezitím uložil někdo jiný. Načtěte ho znovu; váš text zůstává v editoru.",
      draft_changed: "Koncept se od zobrazení změnil. Podívejte se na něj znovu a potvrďte.",
      draft_write_blocked: "Právě probíhá publikování. Zkuste to za chvíli znovu.",
      conflict_active: "Publikování zastavil konflikt; změny zůstávají vidět v konceptu.",
      publish_conflict:
        "Novější práci kolegy nešlo bezpečně spojit s vaší. Postup ukazuje karta konceptu.",
      pull_blocked_by_draft:
        "Kolega změnil stejný záznam, který upravujete. Vraťte ho, stáhněte a upravte znovu.",
      publish_push_failed: "Uloženo, ale server nebyl dostupný. Dokončete odeslání.",
      send_pending: "Publikování čeká na odeslání; nejdřív ho dokončete.",
      nothing_to_send: "Nic nečeká na odeslání.",
      identity_missing:
        "Toto Prostředí nemá jméno a e-mail pro Git; přihlaste se ke GitHubu v Lazuriu.",
      credentials: "Toto Prostředí se k datovému repozitáři nedostane; přihlaste se.",
      validation_failed: "Data porušují pravidlo datového repozitáře. Nic se nepublikovalo.",
      invalid_record: "Záznam neprošel kontrolou. Opravte, co je vypsané níže.",
      not_found: "Záznam neexistuje.",
      bad_request: "Požadavek nemá správný tvar.",
      mount_unavailable: "Data zatím nejsou k dispozici.",
      boundary_violation: "Toto Prostředí má připojená data jiné Organizace nebo jiné větve.",
      config_missing: "Data Organizace zatím nemají nastavení Mission Control.",
      config_changed: "Nastavení dat se změnilo. Obnovte stránku.",
      origin_refused: "Změnu lze poslat jen z Mission Control.",
    } as Record<string, string>,
    unexpected: (code: string) => `Něco se nepovedlo. Technický kód: ${code}.`,
  },
  issue: {
    rule: {
      plan_code_twice: () => "Kód plánu je použitý dvakrát.",
      id_mismatch: (p: Params) => `Id záznamu musí být ${p.expected}.`,
      prefix_mismatch: (p: Params) => `Kód musí začínat prefixem Organizace ${p.prefix}.`,
      file_name: (p: Params) => `Název souboru musí začínat ${p.code}-.`,
      updated_before_created: () => "Datum úpravy je dřív než datum založení.",
      roadmap_code_twice: () => "Kód roadmapy je použitý dvakrát.",
      archived_main: () => "Archivovaná roadmapa nemůže být hlavní.",
      source_plan_missing: (p: Params) => `Zdrojový plán ${p.plan} neexistuje.`,
      priority_id_twice: () => "Některé id priority je použité dvakrát.",
      step_id_twice: (p: Params) => `Krok ${p.step} je použitý dvakrát.`,
      step_timing: (p: Params) => `Krok ${p.step} začíná nebo končí až po svém konci.`,
      step_unknown_priority: (p: Params) =>
        `Krok ${p.step} odkazuje na neznámou prioritu ${p.ref}.`,
      step_unknown_plan: (p: Params) => `Krok ${p.step} odkazuje na neexistující plán ${p.ref}.`,
      main_twice: () => "Hlavní je víc než jedna roadmapa.",
      schema: schemaText(csSchemaKind, csSchemaRule, "Záznam", "Pole"),
      unreadable: () => "Soubor nejde přečíst: není to platný YAML ani JSON.",
      config_missing: () => "Chybí nastavení Mission Control.",
      link_refused: (p: Params) =>
        `${p.path} je symbolický odkaz; odkazy Mission Control nenásleduje.`,
      empty_start: () => "Prázdný start nesmí obsahovat plány ani roadmapy.",
    } as Record<RuleIssueCode, (params: Params) => string>,
  },
};

export type Messages = typeof cs;

const en: Messages = {
  app: {
    loading: "Loading…",
    loadFailed: "The data could not be loaded.",
    notFoundTitle: "This page does not exist",
    backToOverview: "Back to the overview",
  },
  nav: {
    label: "Main navigation",
    overview: "Overview",
    roadmaps: "Roadmaps",
    plans: "Plans",
    newPlan: "New plan",
    draft: "Draft and publish",
    draftBadge: "Unpublished changes",
    organizationPlaceholder: "Your Organization",
  },
  status: {
    shaping: "Shaping",
    ready: "Ready",
    in_progress: "In progress",
    review: "In review",
    blocked: "Blocked",
    done: "Done",
    archived: "Archived",
  },
  priority: {
    urgent: "Urgent",
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  confidence: {
    committed: "committed",
    likely: "likely",
    tentative: "tentative",
  },
  progress: {
    title: (done, total) => `${done} of ${total} steps done`,
    label: (done, total) => `${done}/${total} done`,
  },
  intro: {
    lead: "Mission Control is where your Organization plans the work of people and agents: what is being done and why, in which order, who works on it and how changes reach everyone.",
    items: [
      {
        title: "Plans",
        text: "Every plan has a goal, a scope and acceptance criteria that tell you when it is done.",
      },
      {
        title: "Roadmaps",
        text: "They order plans into steps over time and show what can start now.",
      },
      {
        title: "Who works on what",
        text: "A plan has an owner, tasks have assignees, and a roadmap names the agents doing the work and who reviews it.",
      },
      {
        title: "Draft and publish",
        text: "Every edit is a draft first. Publishing sends it to everyone as one change.",
      },
    ],
  },
  overview: {
    title: "Overview",
    subtitle: (plans, roadmaps, prefix) =>
      `${plural("en", plans, { one: "plan", other: "plans" })} and ${plural("en", roadmaps, { one: "roadmap", other: "roadmaps" })} · plan codes start with ${prefix}`,
    mainRoadmap: "Main roadmap",
    roadmap: "Roadmap",
    nextSteps: "Next steps",
    noNextStep: "No step is waiting to start.",
    until: (period) => `by ${period}`,
    noRoadmapTitle: "No roadmap yet",
    noRoadmapText:
      "A roadmap orders plans into steps over time. Once you have your first plans, ask an agent in Chat to prepare a roadmap from them.",
    activePlans: "Plans under way",
    nothingActive: "Nothing is under way.",
    firstPlanTitle: "Start with your first plan",
    firstPlanText:
      "Describe what you want to change, for whom, and how you will know it is done. Create the plan here, or ask an agent in Chat to prepare it.",
  },
  plans: {
    title: "Plans",
    subtitle: "In working order: rank, then code.",
    filterLabel: "Filter by state",
    all: "All",
    noneInState: "No plan is in this state.",
    none: "There is no plan yet.",
    columns: {
      code: "Code",
      title: "Title",
      status: "State",
      priority: "Priority",
      owner: "Owner",
      updated: "Updated",
    },
  },
  plan: {
    notFound: (code) => `Plan ${code} does not exist`,
    back: "Back to plans",
    edit: "Edit",
    rank: (rank) => `Rank ${rank}`,
    owner: (owner) => `Owner ${owner}`,
    dates: (created, updated) => `Created ${created} · updated ${updated}`,
    context: "Context",
    currentProblem: "Current problem",
    targetState: "Target state",
    scope: "Scope",
    scopeIn: "In scope",
    scopeOut: "Out of scope",
    acceptanceCriteria: "Acceptance criteria",
    validation: "Validation",
    proposedTasks: "Proposed tasks",
    assignee: (who) => `Assigned to ${who}`,
    onRoadmaps: "On roadmaps",
    decisions: "Decisions",
    openQuestions: "Open questions",
    risks: "Risks",
    links: "Links",
  },
  edit: {
    breadcrumb: "Edit",
    title: "Edit the plan",
    subtitle: "Saving creates a draft. Others see it once it is published.",
    titleField: "Title",
    status: "State",
    priority: "Priority",
    rank: "Rank",
    owner: "Owner",
    scopeIn: "Scope: in",
    scopeOut: "Scope: out",
    onePerLine: "One item per line.",
    save: "Save to the draft",
    saving: "Saving…",
    cancel: "Cancel",
  },
  newPlan: {
    title: "New plan",
    subtitle:
      "A plan says why something is done, for whom and how you will know it is done. It is saved as a draft.",
    validationHint: "How you will check that the plan met its goal. One item per line.",
    create: "Create the plan",
    creating: "Creating…",
  },
  roadmaps: {
    title: "Roadmaps",
    subtitle: "A roadmap orders plans into steps over time.",
    none: "There is no roadmap yet. Ask an agent in Chat to prepare one from your plans.",
    main: "Main",
  },
  roadmap: {
    notFound: (code) => `Roadmap ${code} does not exist`,
    back: "Back to roadmaps",
    owner: (owner) => `Owner ${owner}`,
    sourcePlan: "Source plan",
    priorities: "Priorities",
    noTiming: "No date",
    lane: "Who works on this roadmap",
    laneAgents: "Doing the work",
    laneReviewers: "Reviewing",
    laneEscalation: "When a step is stuck",
  },
  draftPage: {
    title: "Draft and publish",
    subtitle:
      "Saved edits are a draft. Publishing sends them in one step to the Organization's data, where everyone sees them.",
    check: "Data check",
    checkUnavailable: "The check cannot run right now.",
    checkOk: "Every record matches its schema and the rules.",
  },
  draft: {
    label: "Unpublished changes and publishing",
    pill: {
      published: "Published",
      draft: "Unpublished changes",
      sending: "Waiting to be sent",
      remote: "Newer data",
      conflict: "Conflict",
      unavailable: "Data not available",
    },
    headline: {
      published: "Everything is published. Nothing is waiting to be sent.",
      draft: (count) =>
        count === 1
          ? "One unpublished change is waiting to be published."
          : `${count} unpublished changes are waiting to be published.`,
      sending: (count) =>
        count > 0
          ? `The publication of ${count === 1 ? "one change" : `${count} changes`} is saved but did not reach the server. Finish sending it.`
          : "The publication is saved but did not reach the server. Finish sending it.",
      remote: "A colleague published newer data.",
      conflict:
        "The data diverged from the server. The changes stay visible, but nothing can be published or returned right now.",
      unavailable: "The data is not available yet.",
    },
    wholeDraft: "The whole draft is published at once, including changes someone else added.",
    waitingForConflict: (count) =>
      count === 1
        ? "1 more record waits for this conflict to be resolved; it is not another conflict."
        : `${count} more records wait for this conflict to be resolved; they are not more conflicts.`,
    owner: (actor) => `Draft started by: ${actor}`,
    details: "Details for resolving it",
    action: {
      publish: "Publish all",
      discard_draft: "Discard all",
      finish_send: "Finish sending",
      retry_send: "Try a safe merge and send",
      pull: "Get the newer data",
      pull_remote: "Get it",
      abort_conflict: "Cancel sending, keep the changes as a draft",
      mark_conflict_resolved: "Mark as resolved",
    },
    reason: {
      resolveConflictFirst: "Resolve the conflict first.",
      pendingUnknown: "The pending publication is not known. Reload the page.",
      alreadySaved:
        "The publication is already saved. Finish it first; taking it back is not the same as discarding a draft.",
      finishSendFirst:
        "Finish sending the saved publication first; until then the last published version is not here.",
      unsupported: "This app does not support this action yet.",
      publishBlocked: "Publishing is not possible right now; the technical detail says why.",
      pullBlocked:
        "A colleague changed the same record you are editing. Return it, get the newer data and edit it again.",
    },
    change: {
      created: "New",
      modified: "Changed",
      deleted: "Deleted",
      unknown: "Change",
    },
    origin: {
      title: "Where the change came from",
      app: "In the app",
      agent: "Agent",
      unknown: "Unknown origin",
    },
    open: "Open",
    revert: "Return the change",
    technical: "Technical detail",
    hideTechnical: "Hide detail",
    revertBlocked: {
      conflict: "Nothing can be returned during a conflict.",
      sending: "Finish sending the saved publication first.",
      other: "This record cannot be returned on its own.",
    },
    confirm: {
      revert: (label) => `Return "${label}" to its published version?`,
      discardAll: (count) =>
        `Discard all unpublished changes (${count})? The last published version comes back.`,
    },
    done: {
      published: "Published.",
      reverted: (label) => `The change of "${label}" was returned.`,
      discarded: "The unpublished changes were discarded.",
      sent: "Sent.",
      merged: "The safe merge worked and the publication is sent.",
      pulled: "The newer data is here.",
    },
    draftChanged:
      "The unpublished changes changed in the meantime. Nothing was done; please review them again.",
  },
  review: {
    type: { plan: "Plan", roadmap: "Roadmap", config: "Settings" },
    configLabel: "Mission Control settings",
    open: "Open",
    created: "New record",
    deleted: "Deleted record",
    changed: (count) => `Fields changed: ${count}`,
    items: (count) => plural("en", count, { one: "item", other: "items" }),
    fields: (count) => plural("en", count, { one: "field", other: "fields" }),
    yes: "yes",
    no: "no",
    field: {
      title: "Title",
      status: "State",
      owner: "Owner",
      priority: "Priority",
      priority_rank: "Rank",
      updated_at: "Updated",
      context: "Context",
      current_problem: "Current problem",
      target_state: "Target state",
      scope: "Scope",
      "scope/in": "Scope: in",
      "scope/out": "Scope: out",
      acceptance_criteria: "Acceptance criteria",
      validation: "Validation",
      open_questions: "Open questions",
      decisions: "Decisions",
      risk_notes: "Risks",
      proposed_tasks: "Proposed tasks",
      summary: "Summary",
      steps: "Steps",
      priorities: "Priorities",
      main: "Main roadmap",
      agent_lane: "Who works on this roadmap",
      plan_prefix: "Plan prefix",
    },
  },
  errors: {
    codes: {
      record_changed:
        "Someone else saved this record in the meantime. Load it again; your text stays in the editor.",
      draft_changed: "The draft changed since it was shown. Look at it again and confirm.",
      draft_write_blocked: "Publishing is under way. Try again in a moment.",
      conflict_active: "A conflict stopped publishing; the changes stay visible in the draft.",
      publish_conflict:
        "A colleague's newer work could not be safely combined with yours. The draft card shows what to do.",
      pull_blocked_by_draft:
        "A colleague changed the same record you are editing. Return it, get the newer data and edit it again.",
      publish_push_failed: "Saved, but the server was not reachable. Finish sending it.",
      send_pending: "A publication is waiting to be sent; finish it first.",
      nothing_to_send: "Nothing is waiting to be sent.",
      identity_missing: "This Environment has no Git name and email; sign in to GitHub in Lazurio.",
      credentials: "This Environment cannot reach the data repository; please sign in.",
      validation_failed: "The data breaks a rule of the data repository. Nothing was published.",
      invalid_record: "The record did not pass the check. Fix what is listed below.",
      not_found: "The record does not exist.",
      bad_request: "The request does not have the expected form.",
      mount_unavailable: "The data is not available yet.",
      boundary_violation:
        "This Environment has the data of another Organization or another branch attached.",
      config_missing: "The Organization's data has no Mission Control settings yet.",
      config_changed: "The data settings changed. Reload the page.",
      origin_refused: "A change can be sent only from Mission Control.",
    },
    unexpected: (code: string) => `Something went wrong. Technical code: ${code}.`,
  },
  issue: {
    rule: {
      plan_code_twice: () => "The plan code is used twice.",
      id_mismatch: (p) => `The record id must be ${p.expected}.`,
      prefix_mismatch: (p) => `The code must start with the Organization's prefix ${p.prefix}.`,
      file_name: (p) => `The file name must start with ${p.code}-.`,
      updated_before_created: () => "The update date is before the creation date.",
      roadmap_code_twice: () => "The roadmap code is used twice.",
      archived_main: () => "An archived roadmap cannot be the main roadmap.",
      source_plan_missing: (p) => `The source plan ${p.plan} does not exist.`,
      priority_id_twice: () => "A priority id is used twice.",
      step_id_twice: (p) => `Step ${p.step} is used twice.`,
      step_timing: (p) => `Step ${p.step} starts or ends after its end.`,
      step_unknown_priority: (p) => `Step ${p.step} names the unknown priority ${p.ref}.`,
      step_unknown_plan: (p) => `Step ${p.step} names the plan ${p.ref}, which does not exist.`,
      main_twice: () => "More than one roadmap is marked main.",
      schema: schemaText(enSchemaKind, enSchemaRule, "Record", "Field"),
      unreadable: () => "The file cannot be read: it is not valid YAML or JSON.",
      config_missing: () => "The Mission Control settings are missing.",
      link_refused: (p) => `${p.path} is a symbolic link; Mission Control does not follow links.`,
      empty_start: () => "The empty start must hold no plans or roadmaps.",
    },
  },
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { cs, en };

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** An issue of the data, worded for a person. */
export function issueText(
  messages: Messages,
  issue: { code: RuleIssueCode; params?: Params },
): string {
  return messages.issue.rule[issue.code](issue.params ?? {});
}

/** A refusal of the API, worded for a person; unknown codes say so with the code. */
export function errorText(messages: Messages, code: string): string {
  return messages.errors.codes[code] ?? messages.errors.unexpected(code);
}
