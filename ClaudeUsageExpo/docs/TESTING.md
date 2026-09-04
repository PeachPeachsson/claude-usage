# Testing

## Test Strategy

Testerna använder `jest-expo` och React Native Testing Library, vilket är Expos rekommenderade testmiljö för React 19. Strategin följer förändringsrisken:

1. Ramverksfri domänlogik karakteriseras direkt med tabellstyrda enhetstester.
2. Infrastruktur testas vid importerade seams med mockad `fetch`, SecureStore och klocka.
3. Dashboarden testas genom användarsynliga resultat med mockade native-effekter och WebView-transport.
4. Refaktorering får bara röra moduler vars relevanta beteenden står som pinnade i kartan nedan.
5. Upptäckta avvikelser karakteriseras först och rättas senare i separata beteendecommits.

Grön gate är `npm run check`, som kör lint, TypeScript och samtliga tester. `npm run test:coverage` används diagnostiskt. Coverage bedöms per riskmodul; ingen godtycklig global procentsats får ersätta beteendetäckning.

Baslinje 2026-09-04:

| Område | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Totalt testad appkod | 62,57 % | 63,50 % | 61,14 % | 65,14 % |
| `src/domain/usage.ts` | 97,82 % | 92,92 % | 100 % | 98,64 % |
| `src/features/dashboard/UsageDashboard.tsx` | 51,49 % | 51,23 % | 48,48 % | 54,36 % |
| Infrastruktur totalt | 83,56 % | 72,58 % | 100 % | 86,46 % |

## Safety Net Map

| Module | Pinned behaviors | Test files | Gaps |
|---|---|---|---|
| `src/domain/usage.ts` | Claude 5h/vecka/scoped; högsta scoped-gräns; fallbacktitel; saknade datum; clamp 0–100; ogiltiga fönster; Codex snake/camel case; numeriska strängar; durationstyrd klassning; weekly-only; response-order fallback; relativa resetdatum | `__tests__/usage.test.ts` | Fler verkliga leverantörsfixtures; lokaliserad JSON-parse recovery är medvetet inte pinnad som önskat beteende |
| `src/infrastructure/claudeWebBridge.ts` | HTTPS-allowlist; subdomäner; lookalike-avvisning; giltiga meddelanden; ogiltiga envelopes; request-ID-escaping; nuvarande endpoints | `__tests__/bridges.test.ts` | Runtime-schema validerar ännu inte varje unionsvariant |
| `src/infrastructure/codexWebBridge.ts` | HTTPS-allowlist; message envelope; request-ID-escaping; nuvarande endpoints | `__tests__/bridges.test.ts` | Transporten används inte av dashboarden; full payloadvalidering saknas |
| `src/infrastructure/codexDeviceAuth.ts` | Device-code mapping; minsta pollintervall; fallback-expiry; 403/404 pending; token exchange; fyra Keychain-värden; saknade tokens; authheaders; oläsbar JWT utan kontoheader; 401 refresh + exakt en retry; refresh rejection + rensning; explicit rensning; 15 s timeout | `__tests__/codexDeviceAuth.test.ts` | Tillfälliga pollnätfel; andra JWT-varianter; andra svarskoder efter retry |
| `src/features/dashboard/UsageDashboard.tsx` | Frånkopplat Claude-läge; providerbyte och persistens; framgångsrik Claude-hämtning; kvar/använt-rendering; stale snapshot vid bridgefel; stale snapshot vid auth expiry; korrekt recovery-CTA; explicit monitor in/ut; login utan manuell Klar; Google-navigation och bridge-signal blockeras | `__tests__/UsageDashboard.test.tsx` | Codex-modal och expiry; frånkopplingsbekräftelse/cookiefallback; AppState/auto-refresh; request-timeout; kontoblad; VoiceOver announcements; större text och Reduce Motion |

Rader i kolumnen Gaps är utanför den refaktoreringsbara säkerhetsytan tills motsvarande test har lagts till.

## Characterization Backlog

- [ ] Pinna Codex-modalens start, expiry, retry och lyckade återgång (hög authrisk, P0).
- [ ] Pinna Claude/Codex-frånkoppling inklusive Expo Go-fallback (hög authrisk, P0).
- [ ] Pinna request-timeout och ignorering av sena WebView-svar (felaktig state-risk, P0).
- [ ] Pinna AppState och tyst automatisk refresh/deduplicering (resiliensrisk, P1).
- [ ] Pinna kontoblad, VoiceOver announcements och reducerad rörelse (tillgänglighetsrisk, P1).
- [ ] Lägg till fixtures från verkliga, anonymiserade Claude/Codex-payloads (schemadrift, P1).
- [ ] Lägg till fysisk iPhone-E2E för båda loginflödena med Maestro/EAS (integrationsrisk, P1).

## CI Gates

- Lokal obligatorisk gate: `npm run check`.
- Coverage-diagnostik: `npm run test:coverage`.
- Phase 2-baslinje: 59 tester i fyra filer, samtliga gröna.
- Strukturcommits får inte ändra förväntade resultat eller snapshots.
- Beteendeändringar ska ha ett test som går rött före fix och grönt efter fix.
- [ ] Lägg `npm run check` i CI på varje pull request (ägare: repoägare, prioritet: P0 före release).
- [ ] Lägg till iOS-bundle/export som separat CI-gate (ägare: repoägare, prioritet: P1 före release).
