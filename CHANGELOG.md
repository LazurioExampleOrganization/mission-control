# Changelog

## 3.0.0 — 2026-10-16

First public release as `Lazurio/mission-control`, published with fresh Git
history from the audited tree of the private MissionControlTemplate. App
behaviour is unchanged from the entries below.

- Public upstream identity: docs and the install contract name
  `upstream=Lazurio/mission-control`; Organization forks integrate release tags.
- The built-in no-live-data guard lists fictional canary identities instead of
  real Organization and people names.
- Test fixtures and examples use fictional plan codes and repositories.
- The frozen historical writer design (`docs/history/`) is not part of the
  public tree.
- The user interface is Czech only for now; the English UI is tracked as an
  issue.

## Before the public release (MissionControlTemplate)

Entries below are carried over from the private template's changelog (partly
in Czech).

### Unreleased at the time of the public release

- Lazurio Module Standard (decision 0171): App `app/v3` startuje jedním
  procesem `bun run src/server.ts`; build klienta je deklarovaná příprava
  (`lazurio.preparation`: `prepare:app`, `check:prepared`), kterou spouští
  Launchpad před startem. Host a port čte server jen z
  `LAZURIO_RUNTIME_LISTENER_WEB_HOST/_PORT` přes `@lazurio/module-kit` a lease
  soubor už nečte. Každá chyba startové konfigurace (chybějící listener,
  ne-loopback host, neplatný hosted origin) končí kódem 2; SIGTERM končí
  kódem 0. Launchpad spouští jen `lazurio.runtime.dev_script` = `dev`, jeden
  proces serveru (bez `preview_script`; aliasy `start`/`preview` i root start
  skripty jsou pryč); `check:prepared` je read-only kontrola
  `dist/index.html`. `scripts/check-template.mjs` ověřuje, co se skutečně
  spouští: `dev_script`, přesný `dev`, deklarovanou přípravu a readiness
  check, který spustí v jednorázové kopii (bez buildu musí selhat, s buildem
  projít, nic nezapsat a doběhnout do 15 s). Další package skripty jsou
  pohodlí pro vývojáře, které Launchpad nikdy nespouští; detekce aliasů se
  nedá udělat úplná a není bezpečnostní hranicí, proto ji guard nedělá.
  Vendored knihovny App jsou TypeScript strict, `bun run check` = typecheck +
  Biome a `bun test` v `app/v3` běží vždy nad šablonovými fixtures. Chování
  aplikace (routy, data, UI) se nemění.
- Hosted workspace VM (decision 0146): loopback HTTP server nově přijímá
  `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN` od Launchpadu a přidá přesný
  veřejný `https://mission-control.<vm>.<organization>.lazurio.io` origin do
  pevného `Host`/`Origin` allowlistu, takže požadavky přes gateway už nekončí
  `forbidden_host`. Bind zůstává loopback-only, session/CSRF guardy se nemění,
  bez proměnné je chování shodné s lokálním profilem a neplatná hodnota
  (ne-`https`, cesta, credentials, ne-DNS hostname) zastaví start serveru.
- Aktualizace již publikovaných dat ověřují cílový stav připnutým validátorem
  bez opakovaného schvalování historických commitů. Zachovávají ověření
  zdroje, kompatibility schémat, neměnnosti auditní historie a ochranu
  lokálních změn. Stavové API zvládá starší konfiguraci a přenáší jen přehled
  historie; přímé spuštění aplikace má stejný validační kontext jako root runner.

- Aktivní Mission Control zápis má jediný standardní tok: lokální reviewovaný
  draft → pinned validace → jeden single-parent commit → běžný non-force
  fast-forward push pod GitHub identitou Principála. Legacy capability writer,
  jeho CLI/runtime, approve/supersede HTTP větve a UI fallback byly odstraněny.
  Existující changeset/writer-audit/provenance data zůstávají pouze jako
  neměnná historie ověřovaná standalone validátorem; nové publikace je
  nevytvářejí ani nemění.
- Výchozí `local-principal-v1` používá stejný nativní Git setup jako
  Principálův terminál: `git` z `PATH`, běžnou local/global/system commit
  identitu, SSH config/agent a Git credential helpery. GitHub repository
  grants zůstávají jedinou access autoritou; Mission Control dál čistí
  zděděné Git transakční prostředí, blokuje checkout-local repository routing,
  vypíná checkout hooks a odmítá nedůvěryhodný remote/branch, divergenci,
  force push a nevalidovaná data.
  Stejný PATH resolver nyní používá standalone validátor i vendored app
  knihovna, takže Scoop/Nix/asdf/Linuxbrew a per-user instalace neselhávají jen
  kvůli vlastnímu allowlistu executable cest.
- Plánové schéma a všechny app/data validační cesty nyní shodně přijímají
  striktní `incident_addendum`, vážou legacy ClickUp `custom_id` na
  Organization `plan_prefix` a považují pouze lowercase `.yaml` za kanonickou
  příponu plánu; roadmapy dál podporují také lowercase `.yml`. README současně
  popisuje upstream-first změny a merge-only synchronizaci Organization forků
  bez obousměrného automatického zrcadlení nebo přenosu jejich dat.
- Standalone data validator intentionally retains strict read and immutability
  checks for already committed changeset, writer-audit, provenance and
  quarantine records. These records are frozen history, not an active writer
  lifecycle, and the runtime exposes no path that creates or advances them.

### 2026-07-19

- Samostatný validátor dat Organizace nyní vynucuje úplnou policy omezeného
  writera a váže operace aktivních changesetů na
  `publish_policy.protected_paths`.
- Template i runtime validace odmítá duplicitní, placeholderové a ne-ASCII
  identifikátory writerů; strojový identifikátor používá pouze lowercase
  ASCII písmena, číslice, tečku, podtržítko a spojovník.
- Supersession failuje zavřeně, dokud připojený data control plane explicitně
  nedeklaruje terminální auditní adresář. Rollout manuály popisují samostatnou
  Admin-approved migraci, její pořadí i rollback.
- TODO export zachovává a při přeražení ID přemapuje vazby `blocked_by`,
  ponechává externí závislosti beze změny a nedovolí dvěma úlohám v jednom
  exportu sdílet stejné výsledné ID.
- Sjednocena bezpečnostní Git subprocess hranice publish a pull cesty.
- Freshness a fast-forward pull nyní před fetch ověřují deklarovaný
  repository-db remote, odmítají lokální routing/command override a ignorují
  zděděné Git repository/URL/transport proměnné.
- Git se spouští pouze přes trusted absolutní systémovou binárku, ne z
  zděděného `PATH`. SSH transport obdobně používá pinned OpenSSH bez
  uživatelského `~/.ssh/config`, proxy/local-command funkcí a se striktním
  known-hosts ověřením; cestu ke known-hosts odvozuje z nativních údajů účtu,
  ne ze zděděného `HOME`.
- Git subprocessy zahazují zděděné TLS, proxy a trace proměnné, takže okolní
  proces nemůže vypnout ověření certifikátu, přesměrovat fetch ani vynést
  diagnostiku do zvoleného souboru. Názvy proměnných se porovnávají bez ohledu
  na velikost písmen, aby ochranu nešlo obejít na Windows.
- Push-only `remote.origin.pushurl` zůstává pro pull povolený, aby dočasný
  `/dev/null` write guard neblokoval read-only synchronizaci.
- Branch se validuje úplnými Git pravidly s rezervovaným `HEAD`; fetch a
  následný bundle create/import sdílejí jeden timeout deadline.
- Selhání fetch bez cacheované remote ref se přizná jako `fetch_failed`, ne
  jako neexistující remote větev.
- Inbound pull povolí bez dalšího důkazu jen běžná doménová data pod
  `data/mission-control/**`; policy-bearing
  `data/mission-control/mission-control.config.json` i ostatní
  code/control-plane cesty vyžadují pinned commit+tree+path approval
  v app-code repu.
- Selhání requested fetch vždy blokuje nabídku pullu, i když starý tracking
  ref už ukazuje novější commit.
- Cached tracking ref už není trust anchor: inbound diff vychází z merge-base
  s lokálním HEAD, pull vždy provede izolovaný fetch a mergeuje přesný ověřený
  commit. Status-only `fetch:false` nemůže autorizovat merge.
- Kontrola čistoty control-plane porovnává HEAD a index přesně, ale pracovní
  kopii bezpečně toleruje s CRLF konci řádků bez spuštění checkout filtrů.
- Kontrola zahrnuje i přesný `100644` mode v HEAD a indexu, takže staged
  executable-bit změna control-plane zablokuje síť ještě před fetch.
- Nested Git behavior soubory (`.gitignore`, `.gitattributes`, `.gitmodules`)
  jsou inbound control-plane a ignorované untracked soubory pod
  `data/mission-control/` se počítají jako dirty draft, takže je pull nepřepíše.
- Fetch odmítá case-colliding cesty a case alias
  `mission-control.config.json` ještě před importem objektů; kolize kontroluje
  i v každém adresářovém segmentu a raw Git cesty dekóduje jako striktní UTF-8.
- Remote a branch jsou před sítí ukotvené v čistém HEAD/index control-plane;
  lokální současná změna configu a `origin` proto nemůže odvést credential na
  jiný server.
- Fetched tree odmítá symlinky, gitlinky, neportabilní cesty a executable
  doménová data a každý snapshot s reálnou inbound změnou před tracking-ref
  update projde pinned validátorem v izolovaném checkoutu. Equal/behind ref ani
  empty commit nenesou nové bajty; lokální mutace se dál validují před
  commit/push.
- Publish spouští pouze pinned app-code data validator bez Git credential
  metadata, SSH agent socketu a zděděných Node code-injection voleb; validator
  bere runtime závislosti z nezávisle instalovaného `app/v3`, nikdy executable
  validator z data checkoutu.

### 2026-06-26

- Added the first reusable Mission Control data adapter baseline for repository-db-mounted `mission-control-data` checkouts.
- Covered plan, roadmap, issue, TODO/DONE, report, and import-review reads with tests.
- Added a fail-closed guard for legacy Mission Control write targets when the compatibility bridge forbids legacy writes.
- Extended template validation so the runtime adapter and its tests remain part of the template contract.

### 2026-06-23

- Aligned the Organization data scaffold with the upstream `repository-db.config.v1` contract and `data/` / `generated/` / `scripts/` layout.
- Added guarded Roadmap Priority / Roadmap Step planning model docs and template validation so repository-db roadmaps cannot drift away from the bundled roadmap schema.
- Created initial MissionControlTemplate skeleton for the cross-Organization Mission Control Roadmaps rollout.
- Added repository-db data-boundary and Doctor-managed install docs.
- Bundled initial Mission Control plan and roadmap schemas copied from CompaniesAsCode as the starting contract.
