# Technical Debt

## Debt Ledger

| Item | Location | Type | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Dashboardens 1 060-raders koordinator äger fortfarande auth, nätverk, persistens, timers och native-effekter | `src/features/dashboard/UsageDashboard.tsx` | Struktur | Hög förändringsrisk i kvarvarande stateorkestrering | L | P0 | Presentation extraherad i Phase 3; controller/use-case-gränser planeras i Phase 5 |
| Claude-bridgeparsern accepterar okända typer och ofullständiga kända meddelanden | `src/infrastructure/claudeWebBridge.ts` | Typ-/runtime-säkerhet | Felaktig data kan passera TypeScript-gränsen | S | P0 | Karakteriserad; separat beteendefix krävs |
| Malformerad JSON visar rå `SyntaxError` i stället för lokaliserat fel | `src/domain/usage.ts` | Felhantering | Teknisk/engelsk text kan nå användaren | S | P1 | Karakteriserad; separat beteendefix krävs |
| Två `exactOptionalPropertyTypes`-fel i oanvänd Expo-mallkod | Borttagen create-expo-mall | TypeScript/död kod | Brus i en framtida skärpt gate | S | P1 | Löst i Phase 3; samtliga beslutade TypeScript-regler är aktiva |
| Snapshots lagras endast i minne | Dashboardstate | Resiliens/dokumentation | Senast hämtat värde försvinner vid kallstart | M | P1 | Beslut krävs före beteendeändring |
| Codex WebView-transport är oanvänd utom URL-konstanter | Ersatt av `src/infrastructure/codexWeb.ts` | Död kod | Dubbla implementationsvägar driver isär | S | P1 | Löst i Phase 3; oanvänd transport och dess tester borttagna |
| Oanvänd create-expo-app-mallkod ligger kvar | Borttagna `components/`, `hooks/`, `constants/` och reset-script | Död kod | Brus och falska TypeScript-fel | S | P1 | Löst i Phase 3 |
| Lyckad Codex-refresh kunde återtrigga starteffekten utan slut | Dashboardens refreshcallbacks | State-/effektfel | Upprepade nätverksanrop och möjlig batteri-/rate-limit-påverkan | S | P0 | Löst med stabil callback och senaste snapshot-ref; regressionstest tillagt |
| Codex usage bygger på intern, odokumenterad endpoint | `src/infrastructure/codexDeviceAuth.ts` | Integrationsrisk | Schemat eller routen kan ändras utan förvarning | M | P0 före release | Phase 7 |
| Tillfälligt nätfel under device-code-poll avbryter hela loginflödet | `UsageDashboard.tsx`, Codex auth | Resiliens | Onödig misslyckad onboarding | M | P1 | Phase 7/beteendefix |
| Ingen CI kör lint, TypeScript eller tester | Repository | Leveransrisk | Regressioner kan mergeas trots lokal gate | S | P0 före release | Öppen |
| Ingen verifierad fysisk iPhone-E2E | Login, orientation, cookies | Testgap | Native skillnader fångas inte av Jest | M | P0 före release | Öppen |
| Produktion och faktisk användarvolym är odokumenterade | Produkt/release | Kravskuld | Reliability-krav kan inte dimensioneras | S | P1 före Phase 7 | Öppen |

## Smell Inventory

| Smell | Location | Refactoring | Status |
|---|---|---|---|
| Long Function / Large Component | `UsageDashboard` | Extract controller/use-case hooks efter fortsatt authpinning | Delvis löst: tema, styles, displayregler och paneler flyttade; orkestrering återstår till Phase 5 |
| Blandade abstraktionsnivåer | Dashboard callbacks och renderträd | Extract orchestration hooks/use cases stegvis | Delvis löst i presentationen; state-/effektlagret återstår |
| Primitive obsession kring provider/state records | Dashboard | Introduce domain types/state reducer efter testutökning | Inventerad |
| Duplicerad bridgeunion och envelope-parser | Claude/Codex bridges | Remove Dead Code | Löst genom borttagning av den oanvända Codex-bridgen |
| Contextless catches | Dashboard/native fallback och JWT-parser | Behåll endast avsiktliga boundary-catches; logga/typbestäm övriga | Löst i aktiva flöden; oanvänd bridge tas bort i Phase 3 |
| Dead code | Codex WebView bridge och Expo-mall | Remove Dead Code | Löst i två separata strukturcommits |

## Phase 3 Refactoring Log

| Smell | Named refactoring | Result |
|---|---|---|
| Dead Code / Speculative Generality | Remove Dead Code | 590 rader Expo-mall och oanvänd Codex-WebView-transport borttagna |
| Divergent Change | Extract Module | Tema och StyleSheet isolerade från dashboardkoordinatorn |
| Feature Envy / blandade abstraktionsnivåer | Move Function | Provider-/displayregler flyttade till `dashboardModel.ts` |
| Large Component | Extract Component | Monitor och kapacitetspaneler flyttade till `DashboardPanels.tsx` |
| Svag statisk gate | Introduce Assertion via compiler options | Sex strikta TypeScript-skydd körs permanent i `npm run check` |

Strukturpoäng efter Phase 3: **6/10**. Vägen till 10/10 kräver främst separata auth-/refreshcontrollers, en explicit state-modell, full runtimevalidering av Claude-bridge och CI-gaten. Detta hör hemma i Phase 5 och Phase 7 snarare än i en större osäker Phase 3-omskrivning.

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
- Booleaner namnges som predikat; UI-events använder `handle…`; kommandon med persistens eller andra sidoeffekter ska säga det i namnet.
- Extern data valideras vid systemgränsen innan den når domän- eller UI-logik.
- Tomma catches är förbjudna om de inte utgör en namngiven och dokumenterad best-effort-gräns.
- `noUncheckedIndexedAccess` ingår i den permanenta TypeScript-gaten.
- `npm run check` är den objektiva lokala kvalitetsgaten; Clean Code-poäng används endast diagnostiskt.
