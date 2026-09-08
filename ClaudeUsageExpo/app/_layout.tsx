import { Stack } from 'expo-router';
import { LogBox } from 'react-native';

// Expo Go warns about remote push support whenever expo-notifications is loaded. Kapacitet only
// schedules local notifications, which Expo explicitly supports in Expo Go, so these two generic
// package warnings do not apply to the app. Keep every other warning visible.
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  '`expo-notifications` functionality is not fully supported in Expo Go',
]);

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
