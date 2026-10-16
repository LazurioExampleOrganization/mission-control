# Pravidla pro agenty v Mission Control data repozitáři

Tento privátní repozitář drží kanonická Mission Control data jedné
Organizace. Pracuj pouze jménem aktuálního Principála a nikdy sem nepřenášej
data jiné Organizace. Platí parent Organization `AGENTS.md`.

## Autorita a trust model

- GitHub je jediná autorita přístupu. Kdo má živé write oprávnění k tomuto
  repozitáři, smí jako důvěryhodný Builder přispívat do Mission Controlu.
- Nevytvářej druhý roster, `provider_access_audit`, approval-role ACL,
  changeset approval ani uložený sdílený writer credential. Textová role sama
  nic neautorizuje; rozhoduje úspěšný normální GitHub push aktuální identity.
  Výchozí `local-principal-v1` používá GitHub identitu Buildera. Sdílený Hosted
  Team Workspace smí použít `github-app-workspace-v1`: stejný nativní Git
  writer, exact credential-free HTTPS remote a externí standardní helper s
  fresh krátkodobým exact-repository tokenem. Mission Control nedrží private
  key, token, Team roster ani repo allowlist.
- Builder tým stojí na důvěře a odpovědnosti. Organization Steward sleduje historii,
  rozklíčuje porušení pravidel, případně připraví revert a řeší členství v týmu
  organizačním procesem. Writer není preventivní governance engine.
- Pravidla se nemění podle GitHub plánu. Malý důvěryhodný tým smí začít v
  režimu `trusted-process`, ale i bez provider-side ochrany pracuje přesně tak,
  jako by byla aktivní: žádný force push, delete, přepis historie ani neřízený
  bypass. Než write okruh přestane být osobně dohlédnutelný Stewardem nebo
  broad write získá externí identita či automatizace, Organization Admin
  přejde na plán podporující potřebná pravidla privátní větve a aktivuje
  `provider-enforced`. Pravidlo `v3` zakáže force push, delete a neřízený
  bypass, ale zachová běžnou validovanou fast-forward publikaci.

## Běžný zápis kanonických dat

1. Primary checkout drž na větvi `v3` a před změnou proveď fetch. Pracuj jen z
   čistého, nedivergovaného checkoutu se správným Organization remote.
2. Měň pouze běžná doménová data pod `data/mission-control/`. Žádné secrets,
   tokeny, OAuth/session soubory, osobní cache ani host-specific runtime stav.
3. Před publikací spusť `npm run validate`. Commit musí mít právě jednoho
   rodiče a obsahovat pouze zamýšlené kanonické změny.
4. Publikuj jedině běžným non-force fast-forward pushem na `v3`. Souběžný
   remote advance je normální kolize: stáhni novější stav, změnu znovu ověř a
   teprve potom opakuj běžný push. Nikdy nepoužívej force push ani přepis
   historie.
5. Commit a push v tomto repository-db jsou Publikace dat. Agent je provede
   jen na explicitní pokyn svého Principála v aktuálním threadu; tlačítko
   „Publikovat změny“ je explicitní potvrzení přesně zobrazeného draftu.
   PR proti `v3` je pořád Draft, dokud ho Principál nenechá mergnout.
   Závěrečná zpráva končí: „Mám změny Publikovat tvým jménem? Nebo mám
   požádat jiného oprávněného Principála o kontrolu a Publikaci?“

Mission Control app může před pushem držet lokální draft pod Git metadata,
ukázat jeho přesné cesty a obsah, spustit připnutý validátor a potvrdit exact
remote HEAD. Draft není kanonická pravda a publish nevytváří paralelní
changeset audit; auditní stopou je Git commit a GitHub pusher attribution.

## Control plane a historická kompatibilita

- `mission-control.config.json`, `repository-db.yaml`, validátor, schémata a
  agentní instrukce jsou control plane. Po bootstrapu je měň ve worktree a v
  samostatném control-plane migration PR bez nesouvisejících doménových dat,
  s validací starého i nového tvaru a popsaným rollbackem.
- `publish_policy.protected_paths` musí být konkrétní a neprázdné. Lokální app
  writer nesmí měnit Git behavior soubory ani vlastní control plane.
- `data/mission-control/changesets/{pending,published,superseded}` může
  obsahovat historické záznamy staršího capability writeru. Jsou read-only:
  nemaž je, nepřepisuj a nepoužívej pro nové zápisy. V
  oba nativní writer profily je validátor chápou jako opaque historii: ověřuje bezpečný
  strom, JSON a nulový diff v každém commitu po migraci, ale starý lifecycle
  neinterpretuje jako autoritu.
- Legacy/root mirrory mohou být během migrace čitelné, ale nejsou druhým
  zdrojem pravdy. Cross-repository parity ani hodinový sync nejsou součástí
  publikačního toku.

## Jednorázový bootstrap

Před úplně prvním commitem lze na explicitní pokyn Principála seednout přesný
template-derived tvar, nahradit Organization placeholdery, spustit validátor s
jeho dokumentovaným unborn-bootstrap režimem a vytvořit větev `v3`. Po prvním
commitu tato výjimka končí a platí běžný fast-forward tok výše.

## Předání

- Před handoffem uveď přesný commit, remote/branch, změněné kanonické oblasti a
  skutečný výsledek validace.
- Nepředstírej branch protection, kterou provider neumí vynutit. Když GitHub
  plán nepodporuje zákaz force push/delete na privátní `v3`, drž tuto hranici
  v režimu `trusted-process`, udržuj explicitního Admin ownera přechodu a
  zapiš omezení jako otevřený governance follow-up. Po dosažení růstového
  triggeru je chybějící `provider-enforced` ochrana blocker dalšího rozšíření
  write okruhu, nikoli výjimka z pracovních pravidel.
