import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import { chevauche } from '../src/sim/deplacement';
import { visible } from '../src/sim/navigation';
import { pointDepart, ZONES_REPUBLIQUE } from '../src/sim/objectifs';
import { CAMPS } from '../src/sim/regles';

describe('départs et zones', () => {
  it('les huit premiers départs de chaque camp sont libres et distincts', () => {
    for (const camp of CAMPS) {
      const points = Array.from({ length: 8 }, (_, i) => pointDepart(camp, i, carte));
      for (const p of points) expect(chevauche(p.x, p.z, carte)).toBe(false);
      const cles = new Set(points.map((p) => `${p.x.toFixed(2)}/${p.z.toFixed(2)}`));
      expect(cles.size).toBe(8);
    }
  });

  it('depuis chaque départ, on peut courir tout droit vers la place sans heurter une barrière', () => {
    for (const camp of CAMPS) {
      for (let i = 0; i < 6; i++) {
        const p = pointDepart(camp, i, carte);
        const cible = camp === 'manif' ? p.x + 8 : p.x - 8;
        expect(visible(p.x, p.z, cible, p.z, carte.obstacles, 0.45), `${camp} ${i}`).toBe(true);
      }
    }
  });

  it('les zones sont dans les limites et ne se chevauchent pas', () => {
    for (const z of ZONES_REPUBLIQUE) {
      expect(z.x - z.rayon).toBeGreaterThan(carte.limites.minX);
      expect(z.x + z.rayon).toBeLessThan(carte.limites.maxX);
    }
    for (let i = 0; i < ZONES_REPUBLIQUE.length; i++) for (let j = i + 1; j < ZONES_REPUBLIQUE.length; j++) {
      const a = ZONES_REPUBLIQUE[i]!;
      const b = ZONES_REPUBLIQUE[j]!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.rayon + b.rayon);
    }
  });
});
