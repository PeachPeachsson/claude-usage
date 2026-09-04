export const CODEX_HOME_URL = 'https://chatgpt.com/codex/settings/usage';
export const CODEX_LOGIN_URL = 'https://chatgpt.com/auth/login?next=%2Fcodex%2Fsettings%2Fusage';

export function isCodexURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'chatgpt.com' || parsed.hostname.endsWith('.chatgpt.com'));
  } catch {
    return false;
  }
}
