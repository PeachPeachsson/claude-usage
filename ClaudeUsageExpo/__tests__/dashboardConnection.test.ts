import { worstConnection } from '@/src/features/dashboard/dashboardModel';

describe('worstConnection', () => {
  it('reports the worst provider state', () => {
    expect(worstConnection([{ needsSignIn: false, hasError: false }])).toBe('live');
    expect(worstConnection([{ needsSignIn: false, hasError: true }, { needsSignIn: false, hasError: false }])).toBe('stale');
    expect(worstConnection([{ needsSignIn: true, hasError: true }, { needsSignIn: false, hasError: false }])).toBe('signin');
  });
});
