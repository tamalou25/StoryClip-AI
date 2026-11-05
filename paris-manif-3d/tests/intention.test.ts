import { describe, expect, it } from 'vitest';
import { normaliserIntention, validerIntention } from '../src/sim/intention';

describe("validation d'intention (message non fiable)", () => {
  it('accepte une intention correcte', () => {
    expect(validerIntention({ dx: 0.5, dz: -0.5, action: true })).toEqual({ dx: 0.5, dz: -0.5, action: true, special: false });
  });

  it('ramène une direction trop longue à 1 (pas de vitesse augmentée)', () => {
    const i = validerIntention({ dx: 30, dz: 40 })!;
    expect(Math.hypot(i.dx, i.dz)).toBeCloseTo(1, 9);
  });

  it('normaliserIntention neutralise NaN et Infinity', () => {
    expect(normaliserIntention({ dx: NaN, dz: 1, action: false })).toEqual({ dx: 0, dz: 0, action: false, special: false });
    expect(normaliserIntention({ dx: Infinity, dz: 0, action: true })).toEqual({ dx: 0, dz: 0, action: true, special: false });
  });

  it.each([
    null,
    undefined,
    42,
    'avance',
    [],
    { dx: '1', dz: 0 },
    { dx: NaN, dz: 0 },
    { dx: Infinity, dz: 0 },
    { dx: 0 },
    { dx: 0, dz: 0, action: 'oui' },
    { dx: 0, dz: 0, x: 10 }, // tentative d'imposer une position
    { dx: 0, dz: 0, score: 999 },
    { dx: 0, dz: 0, special: 1 },
  ])('rejette %j', (brut) => {
    expect(validerIntention(brut)).toBeNull();
  });
});
