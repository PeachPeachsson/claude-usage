# Create an App Plan

## Context

- Started: 2026-09-01
- Product: a React Native iPhone app built with Expo that shows Claude subscription usage, reset times, history, and proactive limit warnings.
- Core job: help Claude Pro/Max users understand their remaining capacity before beginning or continuing focused work.
- Riskiest belief: Claude usage data can be collected accurately and reliably enough that users trust the indicator.
- Validation: the underlying need is behaviorally validated; 3-5 relevant Claude users are available for testing.
- Stage and appetite: solo App Store build; focused v1 within 2-3 weeks.
- Initial platform: iPhone through React Native and Expo. Expo Go is the Phase 1 test host; a dedicated development/App Store build follows validation. macOS, iPadOS, watchOS, and cross-device sync are outside v1.
- Initial load assumption: at most 100 daily active users and about 20 refresh actions per user per day.
- Product stance: functionally inspired by the reference product, with original branding, interface, and implementation.

## Phase Status

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 | lean-startup | awaiting-evidence | PRODUCT.md, EXPERIMENTS.md | 2026-09-01 |
| 2 | design-sprint | pending | DESIGN.md, EXPERIMENTS.md | |
| 3 | clean-architecture | pending | ARCHITECTURE.md | |
| 4 | domain-driven-design | pending | ARCHITECTURE.md | |
| 5 | clean-code | pending | TESTING.md | |
| 6 | pragmatic-programmer | pending | TESTING.md, TECH-DEBT.md | |
| 7 | system-design | pending | ARCHITECTURE.md | |
| 8 | ios-hig-design | pending | DESIGN.md | |
| 9 | 37signals-way | pending | PRODUCT.md, STRATEGY.md | |
| 10 | software-design-philosophy | pending | TECH-DEBT.md, ARCHITECTURE.md | |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: &lt;reason&gt; · skipped: &lt;reason&gt;

## Key Decisions

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-09-01 | Intake | Focus v1 on a standalone native iPhone app | The requested product is an iPhone app, not a macOS menu-bar utility or required Mac companion. |
| 2026-09-01 | Intake | Treat trustworthy usage collection as the fatal assumption | Incorrect or stale data destroys the product's primary value. |
| 2026-09-01 | Intake | Build for an initial ceiling of 100 DAU and 20 refreshes per user/day | Keeps the architecture proportional to the expected first-month load. |
| 2026-09-01 | Intake | Use a fixed 2-3 week appetite with flexible scope | Supports a focused App Store v1 built by one person. |
| 2026-09-01 | Intake | Include the iOS HIG review in v1 | Native iPhone interaction, accessibility, widgets, and platform conventions are product-critical. |
| 2026-09-01 | 1 | Treat reliable on-device retrieval of personal Pro/Max usage as the fatal assumption | Demand is already validated; the remaining product risk is accurate and durable data retrieval on iPhone. |
| 2026-09-01 | 1 | Use Anthropic-hosted sign-in, retain the authenticated session only in protected on-device storage, and query usage directly from the device | Existing open-source monitors demonstrate this pattern; isolating the provider behind an adapter contains endpoint-change risk. |
| 2026-09-01 | 1 | Require at least 95% successful refreshes within 15 seconds and values within ±2 percentage points / ±2 minutes | This is the pre-committed trust threshold for EXP-001 across 20 paired observations from three testers. |
| 2026-09-01 | 1 | Use a single-feature technical spike rather than a demand smoke test | Demand is already validated; the remaining uncertainty is whether the iPhone implementation is accurate and trustworthy. |
| 2026-09-01 | 1 | Pivot the client from SwiftUI to React Native with Expo Go for the experiment | The product owner selected React/Expo; `react-native-webview` is available in Expo Go and preserves the same on-device validation path while accelerating iteration. |
| 2026-09-01 | 1 | Use an incognito WebView session during the Expo Go experiment | Destroying and recreating the WebView provides a verifiable disconnect without extracting the httpOnly Claude session cookie inside Expo Go. A production build will use its own app container. |

## Next Actions

- [x] Confirm the proposed phase plan (owner: product owner, priority: P0)
- [x] Enter Phase 1 and codify the existing validation plus the data-reliability experiment (owner: product owner + Codex, priority: P0)
- [x] Approve the Phase 1 PRODUCT.md and EXPERIMENTS.md drafts (owner: product owner, priority: P0)
- [x] Prototype Anthropic-hosted sign-in and on-device usage retrieval behind a replaceable provider adapter (owner: Codex, priority: P0)
- [x] Add refresh timing, anonymized observation sharing, and the 20-row EXP-001 log (owner: Codex, priority: P0)
- [x] Build and simulator-verify the React Native/Expo Go replacement spike (owner: Codex, priority: P0)
- [ ] Open the Expo project on a physical iPhone and confirm that Claude email sign-in returns live usage (owner: product owner, priority: P0)
- [ ] Run 20 paired observations with three testers and return the anonymized comparison sheet and notes (owner: product owner, priority: P0)
- [ ] After EXP-001, move from Expo Go/SDK 54 to a dedicated development build on the current Expo SDK before production hardening (owner: Codex, priority: P1)
