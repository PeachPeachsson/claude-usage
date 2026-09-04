# Product

## Vision

A trustworthy iPhone companion for Claude Pro and Max users, built with React Native and Expo. It shows current capacity and reset times before usage limits interrupt focused work. Authentication is handled by Anthropic, usage metadata is retrieved directly from the device, and credentials and history remain local by default.

## MVP Definition

The experiment MVP is a React Native single-feature validation build running in Expo Go on iPhone.

Included:

- Anthropic-hosted account sign-in.
- Current five-hour session and weekly usage windows returned for the account.
- Used or remaining percentage and reset time.
- Manual refresh and a visible data-freshness timestamp.
- An ephemeral authenticated session in an incognito `react-native-webview`; disconnect destroys the WebView and its session. The production app will use its own native container and Keychain for any explicitly persisted secret.
- A replaceable Claude usage-provider adapter that contains endpoint-specific behavior.

Explicitly excluded from the experiment MVP:

- Charts and long-term history.
- Widgets and background notifications.
- Multiple accounts.
- macOS, iPadOS, watchOS, and cross-device sync.
- Payments, sharing, and localization.

These exclusions constrain the learning build, not the eventual App Store v1. Features graduate into v1 only after EXP-001 proves that the core data can be retrieved accurately and reliably.

## Outcome Roadmap

| Outcome / problem | Job served | Owner | Priority | Status |
|---|---|---|---|---|
| Trust the current usage snapshot | Know whether there is capacity to begin work | Codex + product owner | P0 | EXP-001 |
| Receive a warning before a limit | Avoid an unexpected interruption | Codex | P1 | Pending |
| Understand usage trends | Plan future work sessions | Codex | P2 | Pending |
| View usage without opening the app | Check capacity at a glance | Codex | P2 | Stretch |

## Opportunity Solution Tree Notes

- [ ] Map opportunities after EXP-001 passes (owner: Codex, priority: P1)

## Hook Model

- [ ] Define only after repeat usage is observed (owner: Codex, priority: P2)

## Activation & Retention Plan

| Friction / moment | Fix | Owner | Priority | Status |
|---|---|---|---|---|
| User distrusts account connection | Explain exactly what is read, transmitted, and stored | Codex | P0 | Proposed |
| User cannot judge freshness | Always show the last successful update | Codex | P0 | Proposed |

## Discovery Cadence

- [ ] Run EXP-001 with three target users (owner: product owner, priority: P0)
