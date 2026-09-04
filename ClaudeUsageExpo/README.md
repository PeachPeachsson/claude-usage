# Claude + Codex Usage — Expo spike

React Native/Expo Go version of EXP-001. Claude uses a private, persistent WebView session. Codex uses OpenAI's device-code OAuth flow in Safari and stores its tokens in iOS Keychain. No password, cookie, account identifier, or usage value is sent to an app-owned server.

## Run with Expo Go

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone Camera app and switch between Claude and Codex from the dashboard. Claude is connected inside its WebView. Codex opens OpenAI in Safari, where email, Google, Apple, Microsoft, and phone sign-in can be used.

Codex uses the user's ChatGPT/OpenAI login. Before the first connection, OpenAI requires **Enable device code authorization for Codex** under ChatGPT → Settings → Security. The app links directly to that setting, then creates and copies a one-time code. After authorization, access, ID, and refresh tokens are stored in iOS Keychain through Expo SecureStore. React Native AsyncStorage contains only a connected/not-connected preference. Tokens are refreshed automatically and removed if OpenAI rejects the refresh token.

## Validation scope

- Claude-hosted sign-in and OpenAI device-code sign-in for Codex
- Instant Claude/Codex switching with separate cached snapshots
- Five-hour, weekly, and Claude model-scoped usage
- Reset times and freshness
- Automatic refresh once per minute while the app is active
- Refresh duration and anonymized observation sharing
- Persistent Claude WebView session and Codex Keychain tokens, so reopening the app normally does not require a new login

The Expo Go build is the experiment client. An App Store release should use an Expo development build so the app has its own native container rather than Expo Go's shared host.

Codex quota is currently read from ChatGPT's authenticated `/backend-api/wham/usage` response. This is an internal, undocumented endpoint and should be isolated behind the existing bridge because its route or response schema may change.

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
