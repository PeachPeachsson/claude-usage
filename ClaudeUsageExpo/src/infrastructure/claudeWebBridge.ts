export const CLAUDE_HOME_URL = 'https://claude.ai/';
export const CLAUDE_LOGIN_URL = 'https://claude.ai/login';

export type ClaudeBridgeMessage =
  | { type: 'usage'; requestId: string; status: number; body: string }
  | { type: 'auth-required'; requestId: string; status: number }
  | { type: 'bridge-error'; requestId: string; message: string };

export function isClaudeURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'claude.ai' || parsed.hostname.endsWith('.claude.ai'));
  } catch {
    return false;
  }
}

export function buildUsageRequestScript(requestId: string): string {
  const safeRequestId = JSON.stringify(requestId);

  return `
    (async function () {
      const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
      const requestId = ${safeRequestId};

      try {
        const organizationsResponse = await fetch('/api/organizations', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });

        if (organizationsResponse.status === 401 || organizationsResponse.status === 403) {
          post({ type: 'auth-required', requestId, status: organizationsResponse.status });
          return;
        }

        if (!organizationsResponse.ok) {
          post({
            type: 'bridge-error',
            requestId,
            message: 'Claude returned HTTP ' + organizationsResponse.status + ' while loading the account.'
          });
          return;
        }

        const organizations = await organizationsResponse.json();
        const preferred = Array.isArray(organizations)
          ? organizations.find((organization) =>
              Array.isArray(organization.capabilities) &&
              organization.capabilities.some((capability) =>
                String(capability).toLowerCase().includes('chat') ||
                String(capability).toLowerCase().includes('claude_ai')
              )
            ) || organizations[0]
          : null;
        const organizationId = preferred && (preferred.uuid || preferred.id);

        if (!organizationId) {
          post({ type: 'bridge-error', requestId, message: 'No Claude account with usage information was found.' });
          return;
        }

        const usageResponse = await fetch(
          '/api/organizations/' + encodeURIComponent(organizationId) + '/usage',
          { credentials: 'include', headers: { Accept: 'application/json' } }
        );

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
          message: error instanceof Error ? error.message : 'The Claude request failed.'
        });
      }
    })();
    true;
  `;
}

export function parseBridgeMessage(value: string): ClaudeBridgeMessage | null {
  try {
    const message: unknown = JSON.parse(value);
    if (!message || typeof message !== 'object' || !('type' in message) || !('requestId' in message)) {
      return null;
    }
    return message as ClaudeBridgeMessage;
  } catch {
    return null;
  }
}
