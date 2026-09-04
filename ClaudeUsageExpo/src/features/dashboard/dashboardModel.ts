import { UsageWindow } from '@/src/domain/usage';
import { Palette, UsageProvider } from '@/src/features/dashboard/dashboardTheme';
import { CLAUDE_HOME_URL, CLAUDE_LOGIN_URL, isClaudeURL } from '@/src/infrastructure/claudeWebBridge';
import { CodexAuthRequiredError } from '@/src/infrastructure/codexDeviceAuth';
import { CODEX_HOME_URL, CODEX_LOGIN_URL, isCodexURL } from '@/src/infrastructure/codexWeb';

export const PROVIDERS: UsageProvider[] = ['claude', 'codex'];
export const PROVIDER_META: Record<UsageProvider, { label: string; homeURL: string; loginURL: string }> = {
  claude: { label: 'Claude', homeURL: CLAUDE_HOME_URL, loginURL: CLAUDE_LOGIN_URL },
  codex: { label: 'Codex', homeURL: CODEX_HOME_URL, loginURL: CODEX_LOGIN_URL },
};

export function friendlyError(error: unknown, provider: UsageProvider, hasSnapshot: boolean): string {
  const label = PROVIDER_META[provider].label;
  if (error instanceof CodexAuthRequiredError) {
    return hasSnapshot
      ? 'Logga in igen för att uppdatera. Senast hämtade värde visas.'
      : 'Logga in på Codex för att se dina gränser.';
  }
  const fallback = `${label} kunde inte nås. Kontrollera internet och försök igen.`;
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  return hasSnapshot ? `${message} Senast hämtade värde visas.` : message;
}

export function friendlyTimeout(provider: UsageProvider, hasSnapshot: boolean): string {
  const message = `${PROVIDER_META[provider].label} svarar långsamt. Försök igen om en stund.`;
  return hasSnapshot ? `${message} Senast hämtade värde visas.` : message;
}

export function formatCountdown(expiresAt: Date, currentTime: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt.getTime() - currentTime) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return seconds > 0
    ? `Gäller i ${minutes}:${String(remainder).padStart(2, '0')}`
    : 'Koden har gått ut';
}

export function formatWindowTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5-timmarsgräns';
  if (window.id === 'weekly') return 'Veckogräns';
  return window.title;
}

export function formatMonitorTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5 timmar';
  if (window.id === 'weekly') return 'Vecka';
  return window.title;
}

export function getUsageTint(utilization: number, palette: Palette): string {
  return utilization >= 90 ? palette.danger : palette.accent;
}

export function getProviderFromURL(url: string): UsageProvider | null {
  if (isClaudeURL(url)) return 'claude';
  if (isCodexURL(url)) return 'codex';
  return null;
}

export function isClaudeLoginURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isClaudeURL(url) && parsed.pathname.startsWith('/login');
  } catch {
    return false;
  }
}

export function isGoogleLoginBlockedMessage(value: string): boolean {
  try {
    const message: unknown = JSON.parse(value);
    return Boolean(
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'google-login-blocked',
    );
  } catch {
    // Other bridge messages are parsed by their provider-specific parser.
    return false;
  }
}

export function formatReset(window: UsageWindow, now = new Date()): string {
  const date = window.resetsAt;
  if (!date || !Number.isFinite(date.getTime())) return 'Återställningstid saknas';

  const time = new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  if (window.id === 'five-hour' && date.toDateString() === now.toDateString()) {
    return `Återställs kl. ${time}`;
  }

  const day = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
  return `Återställs ${day} kl. ${time}`;
}

export function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'nyss';
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min sedan`;
}
