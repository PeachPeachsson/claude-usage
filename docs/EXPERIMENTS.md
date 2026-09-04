# Experiments

## Experiment Cards

### EXP-001 — On-device Claude usage accuracy

- Hypothesis: We believe a React Native iPhone app can authenticate a Claude Pro or Max user through an Anthropic-hosted flow and retrieve personal usage accurately enough to be trusted, because existing Claude clients and open-source monitors use the same account-backed usage surfaces.
- Type: Single-feature technical feasibility experiment.
- Primary metric & threshold (pre-committed): Across 20 paired observations from three testers over seven days, covering at least Pro and Max accounts, at least 95% of refreshes must succeed within 15 seconds; usage values must be within ±2 percentage points and reset times within ±2 minutes of Claude Settings → Usage.
- Guardrail metric: The app never observes or stores a password; no token or session credential reaches an app-owned server; the Expo experiment keeps authentication in an incognito on-device WebView; disconnect destroys that WebView session; a production build uses its own native container and iOS Keychain for any explicitly persisted secret.
- Build: A one-screen React Native/Expo Go iPhone client containing Anthropic-hosted sign-in, a replaceable Claude usage-provider adapter, session and weekly values, reset times, manual refresh, freshness state, and disconnect.
- Maximum build time: Two working days for the technical spike.
- Measure: Each tester records the app value and Claude Settings → Usage value at the same moment. The product owner anonymizes and returns the comparison sheet and qualitative notes.
- Decision rule (pivot / persevere / iterate): Persevere only when every accuracy, latency, and security threshold passes. If the data contract alone fails, revise the provider adapter once and rerun the same pre-committed test. If authentication cannot be completed safely or the second run still fails, pause or pivot the personal Pro/Max monitoring approach.
- Result & verdict: The SwiftUI spike exposed an embedded identity-provider spinner. The client was then pivoted to React Native/Expo Go by product-owner decision. The Expo replacement is linted, type-checked, iOS-bundled, and simulator-verified. Google OAuth cannot complete Claude's session inside an embedded iOS WebView; the app now blocks that popup, remains on Claude's page, and directs the user to Claude email or Apple sign-in instead. Awaiting successful email/Apple sign-in, then physical-device verification and 20 paired observations. Each successful refresh records duration and can share an anonymized observation through the iOS share sheet.

## EXP-001 Observation Log

Use tester IDs such as `T1`, `T2`, and `T3`; never record names, email addresses, organization IDs, cookies, or credentials. Capture the app observation with **Share test observation**, then add the matching Claude Settings → Usage values below.

| # | Tester | Tier | Observed at | Refresh (s) | App 5h % | Claude 5h % | Δ pp | App weekly % | Claude weekly % | Δ pp | App reset | Claude reset | Δ min | Success ≤15s | Notes |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|
| 1 | | | | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | | | | |
| 4 | | | | | | | | | | | | | | | |
| 5 | | | | | | | | | | | | | | | |
| 6 | | | | | | | | | | | | | | | |
| 7 | | | | | | | | | | | | | | | |
| 8 | | | | | | | | | | | | | | | |
| 9 | | | | | | | | | | | | | | | |
| 10 | | | | | | | | | | | | | | | |
| 11 | | | | | | | | | | | | | | | |
| 12 | | | | | | | | | | | | | | | |
| 13 | | | | | | | | | | | | | | | |
| 14 | | | | | | | | | | | | | | | |
| 15 | | | | | | | | | | | | | | | |
| 16 | | | | | | | | | | | | | | | |
| 17 | | | | | | | | | | | | | | | |
| 18 | | | | | | | | | | | | | | | |
| 19 | | | | | | | | | | | | | | | |
| 20 | | | | | | | | | | | | | | | |

Pass the experiment only when at least 19 rows have `Success ≤15s = yes`, every populated usage delta is at most 2 percentage points, every available reset delta is at most 2 minutes, and all privacy guardrails hold.

## Experiment Backlog

| Idea | ICE (impact/confidence/ease) | Owner | Priority | Status |
|---|---:|---|---|---|
| Background notification freshness under iOS constraints | 36 | Codex | P1 | Queued |
| Trust and completion of account connection | 48 | Product owner | P1 | Queued |
| Seven-day return usage | 36 | Product owner | P2 | Queued |
| Widget engagement | 24 | Product owner | P2 | Deferred |
