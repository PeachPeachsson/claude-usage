import {
  buildUsageRequestScript,
  isClaudeURL,
  parseBridgeMessage,
} from '@/src/infrastructure/claudeWebBridge';
import {
  isCodexURL,
} from '@/src/infrastructure/codexWeb';

describe('provider URL allowlists', () => {
  it.each([
    ['https://claude.ai/', true],
    ['https://api.claude.ai/path', true],
    ['http://claude.ai/', false],
    ['https://claude.ai.attacker.example/', false],
    ['not a URL', false],
  ])('classifies Claude URL %s as %s', (url, expected) => {
    expect(isClaudeURL(url)).toBe(expected);
  });

  it.each([
    ['https://chatgpt.com/', true],
    ['https://auth.chatgpt.com/path', true],
    ['http://chatgpt.com/', false],
    ['https://chatgpt.com.attacker.example/', false],
    ['not a URL', false],
  ])('classifies Codex URL %s as %s', (url, expected) => {
    expect(isCodexURL(url)).toBe(expected);
  });
});

describe('Claude bridge messages', () => {
  it.each([
    [{ type: 'usage', requestId: 'r1', status: 200, body: '{}' }],
    [{ type: 'auth-required', requestId: 'r2', status: 401 }],
    [{ type: 'bridge-error', requestId: 'r3', message: 'fel' }],
  ])('parses currently accepted message shape %#', (message) => {
    expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each(['not json', 'null', '{}', '{"type":"usage"}'])('rejects invalid envelope %s', (value) => {
    expect(parseBridgeMessage(value)).toBeNull();
  });

  it('currently accepts an unknown discriminant when requestId exists', () => {
    const message = { type: 'unknown', requestId: 'r4' };
    expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it('escapes request IDs and targets the Claude usage endpoints', () => {
    const script = buildUsageRequestScript('quote"\n</script>');
    expect(script).toContain('const requestId = "quote\\"\\n</script>";');
    expect(script).toContain("fetch('/api/organizations'");
    expect(script).toContain("encodeURIComponent(organizationId) + '/usage'");
  });
});
