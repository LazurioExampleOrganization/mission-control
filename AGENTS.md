# Mission Control — instrukce pro agenty

Tento scope drží lokální plánovací vrstvu AgentMintu.

## Source of truth

Autoritativní data jsou YAML soubory v `plans/`, `data/v1/`, `decisions/`
a dalších budoucích datových složkách. UI ani runtime cache nejsou source
of truth.

## Pracovní pravidlo

Když plánuješ strategický krok, feature nebo experiment:

1. Najdi nebo vytvoř odpovídající YAML plan v `plans/`.
2. Drž v něm kontext, rozhodnutí, scope, non-goals a acceptance criteria.
3. Konkrétní implementační kroky rozpadni do nejbližšího `TODO.tasks.json`.
4. V TODO tasku udržuj `planning` referenci zpět na YAML plan.

## Bezpečnost

- Nezapisuj secrets, tokeny, OAuth session data ani zákaznická data.
- Neopisuj dlouhý chat do YAML bez kurátorského zestručnění.
- Neměň hotové plány tak, aby se ztratila rozhodovací historie; raději přidej
  nový decision nebo outcome.
