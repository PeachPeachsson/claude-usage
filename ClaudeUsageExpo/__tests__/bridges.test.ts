import {
  buildUsageRequestScript,
  isClaudeURL,
  parseBridgeMessage,
} from '@/src/infrastructure/claudeWebBridge';
import {
  buildCodexUsageRequestScript,
  isCodexURL,
  parseCodexBridgeMessage,
} from '@/src/infrastructure/codexWebBridge';

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

describe('Codex bridge messages', () => {
  it('parses a valid usage message', () => {
    const message = { type: 'usage', requestId: 'c1', status: 200, body: '{}' };
    expect(parseCodexBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each(['not json', 'null', '{}', '{"requestId":"c2"}'])('rejects invalid envelope %s', (value) => {
    expect(parseCodexBridgeMessage(value)).toBeNull();
  });

  it('currently accepts a malformed known message with only envelope fields', () => {
    const message = { type: 'usage', requestId: 'c3' };
    expect(parseCodexBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it('escapes request IDs and targets the current Codex endpoints', () => {
    const script = buildCodexUsageRequestScript('code"\n');
    expect(script).toContain('const requestId = "code\\"\\n";');
    expect(script).toContain("fetch('/api/auth/session'");
    expect(script).toContain("fetch('/backend-api/wham/usage'");
  });
});
