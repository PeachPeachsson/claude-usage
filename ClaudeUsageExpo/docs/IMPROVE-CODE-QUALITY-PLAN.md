# Improve Code Quality Plan

## Context

- Startad: 2026-09-04.
- Produkt: Expo/React Native-app för att visa återstående Claude- och Codex-kapacitet samt återställningstid.
- Högsta risk: säker autentisering och tokenhantering, följt av felaktiga eller föråldrade kapacitetsvärden som kan vilseleda användaren.
- Stack: Expo SDK 57, React Native 0.86, React 19, TypeScript 6 i strict-läge. Ingen backend, databas eller ORM.
- Lagring: WebView-cookies för Claude, iOS Keychain via Expo SecureStore för Codex och AsyncStorage för icke-känsliga preferenser.
- Externa beroenden: Claude-webb/API och OpenAI auth/ChatGPT usage. Codex usage använder en intern, odokumenterad endpoint.
- Startmodul: `src/features/dashboard/UsageDashboard.tsx`, med `src/domain/usage.ts` som första rena testpunkt.
- Nuläge: lint, TypeScript och 59 automatiserade tester är gröna. `noUncheckedIndexedAccess` är permanent aktiverat; två `exactOptionalPropertyTypes`-fel återstår endast i oanvänd Expo-mallkod. CI saknas.
- Produktion: repositoryt visar pre-release/prototyp. Ingen verifierad distribution eller användarvolym finns dokumenterad; antagandet ska omprövas före Phase 7.
- Godkänd omfattning: Phase 1–3 nu, Phase 5 och 7 före release, Phase 8–9 uppskjutna tills faktisk backend/data/load finns.

## Phase Status

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 — Build the safety net | working-with-legacy-code | done | TESTING.md + TECH-DEBT.md (GATE) | 2026-09-04 |
| 2 — Make the code readable | clean-code | done | TECH-DEBT.md | 2026-09-04 |
| 3 — Apply named refactorings | refactoring-patterns | in-progress | TECH-DEBT.md | 2026-09-04 |
| 4 — Reduce complexity | software-design-philosophy | deferred: utvärderas efter Phase 3 | TECH-DEBT.md | 2026-09-04 |
| 5 — Draw the architecture boundary | clean-architecture | deferred: genomförs före release | ARCHITECTURE.md | 2026-09-04 |
| 6 — Lock in the habits | pragmatic-programmer | deferred: utvärderas efter strukturpasset | TECH-DEBT.md | 2026-09-04 |
| 7 — Make it survive production | release-it | deferred: genomförs före release | RELIABILITY.md | 2026-09-04 |
| 8 — Size for real load | system-design | deferred: ingen egen backend eller verifierad last | ARCHITECTURE.md + RELIABILITY.md | 2026-09-04 |
| 9 — Get the data layer right | ddia-systems | deferred: ingen databas eller beständig appdata | ARCHITECTURE.md | 2026-09-04 |
| Optional — Domain language | domain-driven-design | deferred: inget verifierat behov ännu | ARCHITECTURE.md | 2026-09-04 |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

## Key Decisions

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-09-04 | Intake | Kör Phase 1–3 nu; Phase 5 och 7 före release; skjut upp 8–9. | Säker förändring och struktur ger värde nu; distribuerade system och databasarbete saknar faktisk belastning eller datalager. |
| 2026-09-04 | 1 | Starta vid `UsageDashboard.tsx` och använd `usage.ts` som första rena testpunkt. | Dashboarden står för cirka 62 % av TS/TSX-koden och har högst churn; domänparsern ger snabbaste stabila säkerhetsnätet. |
| 2026-09-04 | 1 | Karakterisera observerat beteende; logga upptäckta buggar och rätta dem inte i testcommiten. | Refaktorering och beteendeförändringar måste kunna verifieras separat. |
| 2026-09-04 | 1 | Prioritera auth/token-säkerhet före korrekt kapacitetsvisning. | En läckt eller felhanterad inloggning har större konsekvens än ett tillfälligt felaktigt gränsvärde. |
| 2026-09-04 | 1 | Godkänn 57-testersbaslinjen och dokumentera kvarvarande gaps i stället för att bredda gaten godtyckligt. | Kärnregler och kritiska UI-vägar är pinnade; återstående risker är explicita och prioriterade. |
| 2026-09-04 | 2 | Gå direkt vidare till läsbarhets- och TypeScript-passet. | Användaren godkände Phase 1-utkastet och fortsatt arbete. |
| 2026-09-04 | 2 | Aktivera `noUncheckedIndexedAccess`, rätta fem aktiva indexeringsrisker och lämna två mallkodsfel till Remove Dead Code. | Skärper den permanenta gaten utan att blanda in oanvänd mallkod eller beteendefixar. |
| 2026-09-04 | 2 | Använd `npm run check` som objektiv gate; Clean Code-poängen är diagnostisk. | En reproducerbar gate är mer tillförlitlig än en subjektiv poäng. |
| 2026-09-04 | 3 | Tillämpa Remove Dead Code före Extract Function/Component och Move Function. | Mindre yta och färre falska beroenden gör dashboardseparationen säkrare. |

## Next Actions

- [x] Installera och konfigurera Expo-kompatibel testmiljö (Codex, 2026-09-04).
- [x] Pinna domänparser och bridgevalidering med karakteriseringstester (Codex, 2026-09-04).
- [x] Pinna Codex-auth, timeout och tokenförnyelse med importerade seams (Codex, 2026-09-04).
- [x] Pinna dashboardens kritiska tillstånd och felåterställning (Codex, 2026-09-04).
- [x] Presentera och få godkännande för TESTING.md och TECH-DEBT.md (Codex, 2026-09-04).
- [x] Kör clean-code-audit med poäng, prioriterad fixlista och felhanteringsinventering (Codex, 2026-09-04).
- [x] Fatta beslut om Phase 2-fixar, kodkonventioner och eventuell CI-scoregate (Codex + användare, 2026-09-04).
- [x] Aktivera `noUncheckedIndexedAccess`, rätta fem aktiva fel och dokumentera best-effort-gränser (Codex, 2026-09-04).
- [ ] Ta bort verifierat död Expo-mallkod och oanvänd Codex-WebView-transport (Codex, Phase 3).
- [ ] Dela dashboarden med namngivna refaktoreringar inom Safety Net Map (Codex, Phase 3).
