import * as SecureStore from 'expo-secure-store';

const AUTH_BASE_URL = 'https://auth.openai.com';
const CHATGPT_BASE_URL = 'https://chatgpt.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CALLBACK_URL = `${AUTH_BASE_URL}/deviceauth/callback`;
export const CODEX_SECURITY_SETTINGS_URL = `${CHATGPT_BASE_URL}/#settings/Security`;
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const ACCESS_TOKEN_KEY = 'usage-monitor.codex.access-token.v1';
const ID_TOKEN_KEY = 'usage-monitor.codex.id-token.v1';
const REFRESH_TOKEN_KEY = 'usage-monitor.codex.refresh-token.v1';
const ACCOUNT_ID_KEY = 'usage-monitor.codex.account-id.v1';
const NETWORK_TIMEOUT_MS = 15_000;

export type CodexDeviceAuthorization = {
  deviceAuthId: string;
  expiresAt: Date;
  intervalSeconds: number;
  userCode: string;
  verificationUrl: string;
};

type DeviceCodeSuccess = {
  authorizationCode: string;
  codeVerifier: string;
};

type CodexTokenSet = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accountId: string;
};

export class CodexAuthRequiredError extends Error {
  constructor(message = 'Logga in igen för att uppdatera Codex.') {
    super(message);
    this.name = 'CodexAuthRequiredError';
  }
}

export async function requestCodexDeviceAuthorization(): Promise<CodexDeviceAuthorization> {
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error('OpenAI kunde inte starta inloggningen. Försök igen.');
  }

  const payload = await response.json() as Record<string, unknown>;
  const deviceAuthId = readString(payload.device_auth_id);
  const userCode = readString(payload.user_code ?? payload.usercode);
  const intervalSeconds = Math.max(2, Number(payload.interval) || 5);
  const expiresAt = parseExpiry(payload.expires_at);

  if (!deviceAuthId || !userCode) {
    throw new Error('Ingen engångskod skapades. Försök igen.');
  }

  return {
    deviceAuthId,
    expiresAt,
    intervalSeconds,
    userCode,
    verificationUrl: `${AUTH_BASE_URL}/codex/device`,
  };
}

export async function pollCodexDeviceAuthorization(
  authorization: CodexDeviceAuthorization,
): Promise<DeviceCodeSuccess | null> {
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_auth_id: authorization.deviceAuthId,
      user_code: authorization.userCode,
    }),
  });

  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error('OpenAI avbröt inloggningen. Skapa en ny kod och försök igen.');

  const payload = await response.json() as Record<string, unknown>;
  const authorizationCode = readString(payload.authorization_code);
  const codeVerifier = readString(payload.code_verifier);
  if (!authorizationCode || !codeVerifier) {
    throw new Error('OpenAI kunde inte bekräfta inloggningen. Skapa en ny kod.');
  }

  return { authorizationCode, codeVerifier };
}

export async function completeCodexDeviceAuthorization(success: DeviceCodeSuccess): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: success.authorizationCode,
    redirect_uri: DEVICE_CALLBACK_URL,
    client_id: CODEX_CLIENT_ID,
    code_verifier: success.codeVerifier,
  }).toString();
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error('OpenAI kunde inte slutföra inloggningen. Försök igen.');
  }

  const tokens = parseRequiredTokens(await response.json());
  await saveTokens(tokens);
}

export async function fetchCodexUsageWithStoredAuth(): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens) throw new CodexAuthRequiredError();

  let response = await requestUsage(tokens);
  if (response.status === 401 || response.status === 403) {
    tokens = await refreshTokens(tokens);
    response = await requestUsage(tokens);
  }

  if (response.status === 401 || response.status === 403) {
    await clearCodexAuth();
    throw new CodexAuthRequiredError('Din Codex-inloggning har gått ut. Logga in igen.');
  }
  if (!response.ok) throw new Error('Codex kunde inte uppdateras. Försök igen om en stund.');
  return response.text();
}

export async function clearCodexAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(ID_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(ACCOUNT_ID_KEY),
  ]);
}

async function requestUsage(tokens: CodexTokenSet): Promise<Response> {
  const accountId = tokens.accountId || getAccountId(tokens.idToken) || getAccountId(tokens.accessToken);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${tokens.accessToken}`,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;

  return fetchWithTimeout(`${CHATGPT_BASE_URL}/backend-api/wham/usage`, { headers });
}

async function refreshTokens(current: CodexTokenSet): Promise<CodexTokenSet> {
  const response = await fetchWithTimeout(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    }),
  });

  if (!response.ok) {
    await clearCodexAuth();
    throw new CodexAuthRequiredError('Din Codex-inloggning kunde inte förnyas. Logga in igen.');
  }

  const payload = await response.json() as Record<string, unknown>;
  const next: CodexTokenSet = {
    accessToken: readString(payload.access_token) || current.accessToken,
    idToken: readString(payload.id_token) || current.idToken,
    refreshToken: readString(payload.refresh_token) || current.refreshToken,
    accountId:
      readString(payload.account_id ?? payload.accountId) ||
      getAccountId(readString(payload.id_token)) ||
      current.accountId,
  };
  await saveTokens(next);
  return next;
}

async function saveTokens(tokens: CodexTokenSet): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken, SECURE_STORE_OPTIONS),
    SecureStore.setItemAsync(ID_TOKEN_KEY, tokens.idToken, SECURE_STORE_OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, SECURE_STORE_OPTIONS),
    SecureStore.setItemAsync(ACCOUNT_ID_KEY, tokens.accountId, SECURE_STORE_OPTIONS),
  ]);
}

async function loadTokens(): Promise<CodexTokenSet | null> {
  const [accessToken, idToken, refreshToken, storedAccountId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(ID_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(ACCOUNT_ID_KEY),
  ]);
  if (!accessToken || !idToken || !refreshToken) return null;
  const accountId = storedAccountId || getAccountId(idToken) || getAccountId(accessToken) || '';
  return { accessToken, idToken, refreshToken, accountId };
}

function parseRequiredTokens(value: unknown): CodexTokenSet {
  if (!value || typeof value !== 'object') throw new Error('OpenAI kunde inte bekräfta inloggningen. Försök igen.');
  const payload = value as Record<string, unknown>;
  const accessToken = readString(payload.access_token);
  const idToken = readString(payload.id_token);
  const refreshToken = readString(payload.refresh_token);
  const accountId =
    readString(payload.account_id ?? payload.accountId) ||
    getAccountId(idToken) ||
    getAccountId(accessToken) ||
    '';
  if (!accessToken || !idToken || !refreshToken) throw new Error('OpenAI kunde inte slutföra inloggningen. Försök igen.');
  return { accessToken, idToken, refreshToken, accountId };
}

function getAccountId(token: string): string | null {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    const namespacedAccountId = auth && typeof auth === 'object'
      ? readString((auth as Record<string, unknown>).chatgpt_account_id)
      : '';
    return namespacedAccountId || readString(payload.chatgpt_account_id ?? payload.account_id) || null;
  } catch {
    return null;
  }
}

function parseExpiry(value: unknown): Date {
  if (typeof value === 'number') {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return parseExpiry(numeric);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(Date.now() + 15 * 60_000);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OpenAI svarade inte inom 15 sekunder. Kontrollera nätverket och försök igen.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
