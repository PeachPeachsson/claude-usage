export const CODEX_HOME_URL = 'https://chatgpt.com/codex/settings/usage';
export const CODEX_LOGIN_URL = 'https://chatgpt.com/auth/login?next=%2Fcodex%2Fsettings%2Fusage';

export type CodexBridgeMessage =
  | { type: 'usage'; requestId: string; status: number; body: string }
  | { type: 'auth-required'; requestId: string; status: number }
  | { type: 'bridge-error'; requestId: string; message: string };

export function isCodexURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com'));
  } catch {
    return false;
  }
}

export function buildCodexUsageRequestScript(requestId: string): string {
  const safeRequestId = JSON.stringify(requestId);

  return `
    (async function () {
      const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
      const requestId = ${safeRequestId};

      try {
        const headers = { Accept: 'application/json' };
        const sessionResponse = await fetch('/api/auth/session', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });

        if (sessionResponse.ok) {
          const session = await sessionResponse.json();
          const accessToken = session.accessToken || session.access_token || null;
          let accountId = session.accountId || session.account_id || (session.account && session.account.id) || null;

          if (accessToken) {
            headers.Authorization = 'Bearer ' + accessToken;

            if (!accountId) {
              try {
                const encodedPayload = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
                const tokenPayload = JSON.parse(atob(paddedPayload));
                const auth = tokenPayload['https://api.openai.com/auth'];
                accountId = auth && auth.chatgpt_account_id;
              } catch {}
            }
          }

          if (accountId) headers['ChatGPT-Account-Id'] = accountId;
        }

        const usageResponse = await fetch('/backend-api/wham/usage', {
          credentials: 'include',
          headers
        });

        if (usageResponse.status === 401 || usageResponse.status === 403) {
          post({ type: 'auth-required', requestId, status: usageResponse.status });
          return;
        }

        post({
          type: 'usage',
          requestId,
          status: usageResponse.status,
          body: await usageResponse.text()
        });
      } catch (error) {
        post({
          type: 'bridge-error',
          requestId,
          message: error instanceof Error ? error.message : 'The Codex request failed.'
        });
      }
    })();
    true;
  `;
}

export function parseCodexBridgeMessage(value: string): CodexBridgeMessage | null {
  try {
    const message: unknown = JSON.parse(value);
    if (!message || typeof message !== 'object' || !('type' in message) || !('requestId' in message)) {
      return null;
    }
    return message as CodexBridgeMessage;
  } catch {
    return null;
  }
}
