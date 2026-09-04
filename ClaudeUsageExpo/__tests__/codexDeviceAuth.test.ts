import * as SecureStore from 'expo-secure-store';

import {
  clearCodexAuth,
  CodexAuthRequiredError,
  completeCodexDeviceAuthorization,
  fetchCodexUsageWithStoredAuth,
  pollCodexDeviceAuthorization,
  requestCodexDeviceAuthorization,
} from '@/src/infrastructure/codexDeviceAuth';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const ACCESS_TOKEN_KEY = 'usage-monitor.codex.access-token.v1';
const ID_TOKEN_KEY = 'usage-monitor.codex.id-token.v1';
const REFRESH_TOKEN_KEY = 'usage-monitor.codex.refresh-token.v1';
const ACCOUNT_ID_KEY = 'usage-monitor.codex.account-id.v1';

const getItemAsync = jest.mocked(SecureStore.getItemAsync);
const setItemAsync = jest.mocked(SecureStore.setItemAsync);
const deleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);
const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

function response({
  body = {},
  ok = true,
  status = 200,
  text,
}: {
  body?: unknown;
  ok?: boolean;
  status?: number;
  text?: string;
} = {}): Response {
  return {
    json: jest.fn().mockResolvedValue(body),
    ok,
    status,
    text: jest.fn().mockResolvedValue(text ?? JSON.stringify(body)),
  } as unknown as Response;
}

function tokenWithAccount(accountId: string): string {
  const payload = btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function seedStoredTokens(overrides: Partial<Record<string, string | null>> = {}): void {
  const values: Record<string, string | null> = {
    [ACCESS_TOKEN_KEY]: 'access-old',
    [ID_TOKEN_KEY]: tokenWithAccount('account-from-token'),
    [REFRESH_TOKEN_KEY]: 'refresh-old',
    [ACCOUNT_ID_KEY]: 'account-stored',
    ...overrides,
  };
  getItemAsync.mockImplementation(async (key) => values[key] ?? null);
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock, writable: true });
  fetchMock.mockReset();
  getItemAsync.mockReset();
  setItemAsync.mockReset().mockResolvedValue();
  deleteItemAsync.mockReset().mockResolvedValue();
});

describe('Codex device authorization characterization', () => {
  it('maps a device code and enforces a two-second minimum poll interval', async () => {
    fetchMock.mockResolvedValueOnce(response({
      body: {
        device_auth_id: 'device-1',
        user_code: 'ABCD-EFGH',
        interval: 1,
        expires_at: 1_788_561_600,
      },
    }));

    await expect(requestCodexDeviceAuthorization()).resolves.toEqual({
      deviceAuthId: 'device-1',
      expiresAt: new Date(1_788_561_600_000),
      intervalSeconds: 2,
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it('uses the observed fifteen-minute fallback when expiry is missing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
    fetchMock.mockResolvedValueOnce(response({
      body: { device_auth_id: 'device-2', usercode: 'CODE-2' },
    }));

    const authorization = await requestCodexDeviceAuthorization();
    expect(authorization.expiresAt).toEqual(new Date('2026-09-04T12:15:00.000Z'));
    expect(authorization.intervalSeconds).toBe(5);
    jest.useRealTimers();
  });

  it.each([403, 404])('treats HTTP %s as authorization still pending', async (status) => {
    fetchMock.mockResolvedValueOnce(response({ ok: false, status }));
    await expect(pollCodexDeviceAuthorization({
      deviceAuthId: 'device-3',
      expiresAt: new Date('2026-09-04T12:15:00.000Z'),
      intervalSeconds: 5,
      userCode: 'CODE-3',
      verificationUrl: 'https://auth.openai.com/codex/device',
    })).resolves.toBeNull();
  });

  it('exchanges the authorization code and stores all four token values', async () => {
    fetchMock.mockResolvedValueOnce(response({
      body: {
        access_token: 'access-new',
        id_token: tokenWithAccount('account-new'),
        refresh_token: 'refresh-new',
      },
    }));

    await completeCodexDeviceAuthorization({ authorizationCode: 'auth-code', codeVerifier: 'verifier' });

    expect(setItemAsync.mock.calls.map(([key, value]) => [key, value])).toEqual(expect.arrayContaining([
      [ACCESS_TOKEN_KEY, 'access-new'],
      [ID_TOKEN_KEY, expect.any(String)],
      [REFRESH_TOKEN_KEY, 'refresh-new'],
      [ACCOUNT_ID_KEY, 'account-new'],
    ]));
  });
});

describe('stored Codex authentication characterization', () => {
  it('requires login without a complete stored token set', async () => {
    seedStoredTokens({ [REFRESH_TOKEN_KEY]: null });
    await expect(fetchCodexUsageWithStoredAuth()).rejects.toBeInstanceOf(CodexAuthRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the access token and stored account ID when fetching usage', async () => {
    seedStoredTokens();
    fetchMock.mockResolvedValueOnce(response({ text: '{"usage":true}' }));

    await expect(fetchCodexUsageWithStoredAuth()).resolves.toBe('{"usage":true}');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-old',
          'ChatGPT-Account-Id': 'account-stored',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('refreshes once after 401, persists replacement tokens and retries usage', async () => {
    seedStoredTokens();
    fetchMock
      .mockResolvedValueOnce(response({ ok: false, status: 401 }))
      .mockResolvedValueOnce(response({
        body: {
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          account_id: 'account-new',
        },
      }))
      .mockResolvedValueOnce(response({ text: '{"refreshed":true}' }));

    await expect(fetchCodexUsageWithStoredAuth()).resolves.toBe('{"refreshed":true}');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(setItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, 'access-new', expect.any(Object));
    expect(setItemAsync).toHaveBeenCalledWith(ID_TOKEN_KEY, expect.any(String), expect.any(Object));
    expect(setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'refresh-new', expect.any(Object));
    expect(setItemAsync).toHaveBeenCalledWith(ACCOUNT_ID_KEY, 'account-new', expect.any(Object));
  });

  it('clears all stored credentials when token refresh is rejected', async () => {
    seedStoredTokens();
    fetchMock
      .mockResolvedValueOnce(response({ ok: false, status: 401 }))
      .mockResolvedValueOnce(response({ ok: false, status: 400 }));

    await expect(fetchCodexUsageWithStoredAuth()).rejects.toEqual(expect.objectContaining({
      name: 'CodexAuthRequiredError',
    }));
    expect(deleteItemAsync.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([
      ACCESS_TOKEN_KEY,
      ID_TOKEN_KEY,
      REFRESH_TOKEN_KEY,
      ACCOUNT_ID_KEY,
    ]));
  });

  it('clears all credentials on explicit disconnect', async () => {
    await clearCodexAuth();
    expect(deleteItemAsync).toHaveBeenCalledTimes(4);
  });

  it('turns an aborted request into the current friendly timeout error', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = requestCodexDeviceAuthorization();
    const rejection = expect(pending).rejects.toThrow(
      'OpenAI svarade inte inom 15 sekunder. Kontrollera nätverket och försök igen.',
    );
    await jest.advanceTimersByTimeAsync(15_000);
    await rejection;
    jest.useRealTimers();
  });
});
