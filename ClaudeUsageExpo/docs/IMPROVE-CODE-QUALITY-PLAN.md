# Improve Code Quality Plan

## Context

- Startad: 2026-09-04.
- Produkt: Expo/React Native-app för att visa återstående Claude- och Codex-kapacitet samt återställningstid.
- Högsta risk: säker autentisering och tokenhantering, följt av felaktiga eller föråldrade kapacitetsvärden som kan vilseleda användaren.
- Stack: Expo SDK 57, React Native 0.86, React 19, TypeScript 6 i strict-läge. Ingen backend, databas eller ORM.
- Lagring: WebView-cookies för Claude, iOS Keychain via Expo SecureStore för Codex och AsyncStorage för icke-känsliga preferenser.
- Externa beroenden: Claude-webb/API och OpenAI auth/ChatGPT usage. Codex usage använder en intern, odokumenterad endpoint.
- Startmodul: `src/features/dashboard/UsageDashboard.tsx`, med `src/domain/usage.ts` som första rena testpunkt.
- Nuläge: lint och ordinarie TypeScript-kontroll är gröna; automatiserade tester, coverage och CI saknas. Skärpta TypeScript-flaggor visar sju latenta fel.
- Produktion: repositoryt visar pre-release/prototyp. Ingen verifierad distribution eller användarvolym finns dokumenterad; antagandet ska omprövas före Phase 7.
- Godkänd omfattning: Phase 1–3 nu, Phase 5 och 7 före release, Phase 8–9 uppskjutna tills faktisk backend/data/load finns.

## Phase Status

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 — Build the safety net | working-with-legacy-code | in-progress | TESTING.md + TECH-DEBT.md (GATE) | 2026-09-04 |
| 2 — Make the code readable | clean-code | pending | TECH-DEBT.md | |
| 3 — Apply named refactorings | refactoring-patterns | pending | TECH-DEBT.md | |
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

## Next Actions

- [ ] Installera och konfigurera Expo-kompatibel testmiljö (Codex, nu).
- [ ] Pinna domänparser och bridgevalidering med karakteriseringstester (Codex, nu).
- [ ] Pinna Codex-auth, timeout och tokenförnyelse med importerade seams (Codex, nu).
- [ ] Pinna dashboardens kritiska tillstånd och felåterställning (Codex, nu).
- [ ] Presentera utkast till TESTING.md och TECH-DEBT.md för godkännande före skrivning (Codex, Phase 1-exit).
