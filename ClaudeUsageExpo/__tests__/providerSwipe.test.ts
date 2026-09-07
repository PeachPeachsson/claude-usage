import {
  nextHistoryReveal,
  providerForSwipe,
  SWIPE_COMMIT_DISTANCE,
  SWIPE_COMMIT_VELOCITY,
  REVEAL_COMMIT_VELOCITY,
  REVEAL_FLICK_DISTANCE,
  SWIPE_FLICK_DISTANCE,
} from '@/src/features/dashboard/dashboardModel';

const still = { dx: 0, dy: 0, vx: 0 };

describe('landscape provider swipe', () => {
  it('drags left from Claude to Codex', () => {
    expect(providerForSwipe('claude', { ...still, dx: -SWIPE_COMMIT_DISTANCE })).toBe('codex');
  });

  it('drags right from Codex back to Claude', () => {
    expect(providerForSwipe('codex', { ...still, dx: SWIPE_COMMIT_DISTANCE })).toBe('claude');
  });

  it('ignores a swipe past either end of the list', () => {
    expect(providerForSwipe('claude', { ...still, dx: SWIPE_COMMIT_DISTANCE })).toBeNull();
    expect(providerForSwipe('codex', { ...still, dx: -SWIPE_COMMIT_DISTANCE })).toBeNull();
  });

  it('ignores a drag that stops short and is too slow to read as a flick', () => {
    expect(providerForSwipe('claude', { ...still, dx: -(SWIPE_COMMIT_DISTANCE - 1), vx: -0.1 })).toBeNull();
  });

  it('accepts a short but fast flick', () => {
    expect(providerForSwipe('claude', { dx: -SWIPE_FLICK_DISTANCE, dy: 0, vx: -SWIPE_COMMIT_VELOCITY })).toBe('codex');
  });

  it('ignores a twitch that is fast but barely moved', () => {
    expect(providerForSwipe('claude', { dx: -(SWIPE_FLICK_DISTANCE - 1), dy: 0, vx: -1.4 })).toBeNull();
  });

  it('ignores a mostly vertical drag', () => {
    expect(providerForSwipe('claude', { dx: -80, dy: -140, vx: -0.9 })).toBeNull();
  });

  it('ignores a tap that never moved', () => {
    expect(providerForSwipe('claude', still)).toBeNull();
  });
});

describe('landscape history reveal', () => {
  const PANEL = 200;
  const slow = { dx: 0, vy: 0 };

  it('lifts the history when dragged up past a third of the panel', () => {
    expect(nextHistoryReveal(false, { ...slow, dy: -60 }, PANEL)).toBe(true);
  });

  it('puts the limits back when dragged down past a third of the panel', () => {
    expect(nextHistoryReveal(true, { ...slow, dy: 60 }, PANEL)).toBe(false);
  });

  it('keeps the current face when the drag stops short', () => {
    expect(nextHistoryReveal(false, { ...slow, dy: -50 }, PANEL)).toBe(false);
    expect(nextHistoryReveal(true, { ...slow, dy: 50 }, PANEL)).toBe(true);
  });

  it('accepts a short but fast flick', () => {
    expect(nextHistoryReveal(false, { dx: 0, dy: -REVEAL_FLICK_DISTANCE, vy: -REVEAL_COMMIT_VELOCITY }, PANEL)).toBe(true);
  });

  it('ignores a twitch that is fast but barely moved', () => {
    expect(nextHistoryReveal(false, { dx: 0, dy: -(REVEAL_FLICK_DISTANCE - 1), vy: -1.2 }, PANEL)).toBe(false);
  });

  it('leaves a mostly sideways drag to the provider swipe', () => {
    expect(nextHistoryReveal(false, { dx: -120, dy: -70, vy: -0.5 }, PANEL)).toBe(false);
  });

  it('falls back to the flick rule before the panel has been measured', () => {
    expect(nextHistoryReveal(false, { dx: 0, dy: -140, vy: -0.05 }, 0)).toBe(false);
    expect(nextHistoryReveal(false, { dx: 0, dy: -140, vy: -0.5 }, 0)).toBe(true);
  });

  it('ignores a tap that never moved', () => {
    expect(nextHistoryReveal(false, { dx: 0, dy: 0, vy: 0 }, PANEL)).toBe(false);
    expect(nextHistoryReveal(true, { dx: 0, dy: 0, vy: 0 }, PANEL)).toBe(true);
  });
});
