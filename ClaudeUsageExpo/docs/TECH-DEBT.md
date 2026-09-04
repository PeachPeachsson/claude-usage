# Technical Debt

## Debt Ledger

| Item | Location | Type | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Dashboarden äger UI, auth, nätverk, persistens, timers och native-effekter i samma 1 824-raders fil | `src/features/dashboard/UsageDashboard.tsx` | Struktur | Hög förändringsrisk och svår isolerad testning | L | P0 | Planerad Phase 2–3 |
| Bridgeparsers accepterar okända typer och ofullständiga kända meddelanden | `src/infrastructure/*WebBridge.ts` | Typ-/runtime-säkerhet | Felaktig data kan passera TypeScript-gränsen | S | P0 | Karakteriserad; separat beteendefix krävs |
| Malformerad JSON visar rå `SyntaxError` i stället för lokaliserat fel | `src/domain/usage.ts` | Felhantering | Teknisk/engelsk text kan nå användaren | S | P1 | Karakteriserad; separat beteendefix krävs |
| Sju fel under `noUncheckedIndexedAccess` och `exactOptionalPropertyTypes` | Domän, dashboard, auth och Expo-mallkomponenter | TypeScript | Dolda undefined-antaganden | S | P0 | Planerad Phase 2 |
| Snapshots lagras endast i minne | Dashboardstate | Resiliens/dokumentation | Senast hämtat värde försvinner vid kallstart | M | P1 | Beslut krävs före beteendeändring |
| Codex WebView-transport är oanvänd utom URL-konstanter | `src/infrastructure/codexWebBridge.ts` | Död kod | Dubbla implementationsvägar driver isär | S | P1 | Kandidat för borttagning efter testseparation |
| Oanvänd create-expo-app-mallkod ligger kvar | `components/`, `hooks/`, `constants/` | Död kod | Brus och falska TypeScript-fel | S | P1 | Kandidat för borttagning i separat strukturcommit |
| Codex usage bygger på intern, odokumenterad endpoint | `src/infrastructure/codexDeviceAuth.ts` | Integrationsrisk | Schemat eller routen kan ändras utan förvarning | M | P0 före release | Phase 7 |
| Tillfälligt nätfel under device-code-poll avbryter hela loginflödet | `UsageDashboard.tsx`, Codex auth | Resiliens | Onödig misslyckad onboarding | M | P1 | Phase 7/beteendefix |
| Ingen CI kör lint, TypeScript eller tester | Repository | Leveransrisk | Regressioner kan mergeas trots lokal gate | S | P0 före release | Öppen |
| Ingen verifierad fysisk iPhone-E2E | Login, orientation, cookies | Testgap | Native skillnader fångas inte av Jest | M | P0 före release | Öppen |
| Produktion och faktisk användarvolym är odokumenterade | Produkt/release | Kravskuld | Reliability-krav kan inte dimensioneras | S | P1 före Phase 7 | Öppen |

## Smell Inventory

| Smell | Location | Refactoring | Status |
|---|---|---|---|
| Long Function / Large Component | `UsageDashboard` | Extract Function, Extract Component och Introduce Parameter Object efter pinning | Inventerad |
| Blandade abstraktionsnivåer | Dashboard callbacks och renderträd | Extract orchestration hooks/use cases stegvis | Inventerad |
| Primitive obsession kring provider/state records | Dashboard | Introduce domain types/state reducer efter testutökning | Inventerad |
| Duplicerad bridgeunion och envelope-parser | Claude/Codex bridges | Extract shared validated message decoder, om båda transporterna består | Inventerad |
| Contextless catches | Dashboard/native fallback och JWT-parser | Behåll endast avsiktliga boundary-catches; logga/typbestäm övriga | Inventerad |
| Dead code | Codex WebView bridge och Expo-mall | Remove Dead Code | Inventerad |

## Sprout / Wrap Register

Ingen sprout eller wrapper lades till i Phase 1. Testerna använder befintliga importseams och mockar endast effekter som blockerar separation eller sensing: WebView, fetch, SecureStore, AsyncStorage, orientation, browser, clipboard och haptics.

## Debt Budget & Broken-Windows Policy

- Inte beslutad ännu; fastställs i Phase 6.
- Fram till dess ska varje ny upptäckt skuld få en ledger-rad med risk, insats, prioritet och status.
- Inga oregistrerade `TODO`/`FIXME` tillåts i berörda produktionsfiler.
- Beteendefix och strukturrefaktorering landar alltid i separata commits.

## Adopted Conventions

- Karakteriseringstester beskriver observerat beteende; fel rättas inte tyst under testintroduktion.
- Refaktorera endast beteenden som är pinnade utan öppna gaps i Safety Net Map.
- Importseams föredras framför nya produktionsabstraktioner när de räcker för testning.
- Tester ska primärt observera publika resultat och användarbeteende, inte interna hook-implementationer.
- Auth- och tokenfel är P0; felaktiga kapacitetsvärden är nästa risknivå.
