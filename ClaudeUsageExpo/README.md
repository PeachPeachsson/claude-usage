# Kapacitet — Claude + Codex

En iPhone-app som visar hur mycket AI-kapacitet som finns kvar och när gränserna fylls på. Claude använder en privat, beständig WebView-inloggning. Codex använder OpenAI:s enhetskod i Safari och sparar inloggningen i iOS-nyckelringen. Inga lösenord, cookies, kontoidentifierare eller gränsvärden skickas till en appägd server.

## Run with Expo Go

```bash
npm install
npx expo start
```

Skanna QR-koden med iPhone-kameran och växla mellan Claude och Codex på dashboarden. Claude ansluts i appens WebView. Codex öppnar OpenAI i Safari, där e-post, Google, Apple, Microsoft eller telefon kan användas.

Codex uses the user's ChatGPT/OpenAI login. Before the first connection, OpenAI requires **Enable device code authorization for Codex** under ChatGPT → Settings → Security. The app links directly to that setting, then creates and copies a one-time code. After authorization, access, ID, and refresh tokens are stored in iOS Keychain through Expo SecureStore. React Native AsyncStorage contains only a connected/not-connected preference. Tokens are refreshed automatically and removed if OpenAI rejects the refresh token.

## Validation scope

- Claude-hosted sign-in and OpenAI device-code sign-in for Codex
- Instant Claude/Codex switching with separate cached snapshots
- Five-hour, weekly, and Claude model-scoped usage
- Reset times and freshness
- Automatic refresh once per minute while the app is active
- Tydlig felåterställning utan att ett senast hämtat värde försvinner
- Ett uttryckligt liggande monitorläge
- VoiceOver, Dynamic Type, Reduce Motion och haptisk feedback
- Persistent Claude WebView session and Codex Keychain tokens, so reopening the app normally does not require a new login

Expo Go stöder hela läs- och inloggningsflödet. Full lokal cookie-rensning vid frånkoppling kräver en Expo development build; i Expo Go öppnar appen i stället Claudes egen utloggning. En App Store-version bör alltid använda en egen native-container.

Codex quota is currently read from ChatGPT's authenticated `/backend-api/wham/usage` response. This is an internal, undocumented endpoint and should be isolated behind the existing bridge because its route or response schema may change.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.
