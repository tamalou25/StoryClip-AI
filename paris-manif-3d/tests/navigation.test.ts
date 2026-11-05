import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import { chevauche } from '../src/sim/deplacement';
import { estBloque, grillePour, trouverChemin, visible } from '../src/sim/navigation';

describe('navigation', () => {
  it('la grille bloque le socle et laisse les allées libres', () => {
    const g = grillePour(carte);
    expect(estBloque(g, 0, 0)).toBe(true);
    expect(estBloque(g, -20, 0)).toBe(false);
    expect(estBloque(g, 0, 12)).toBe(false);
  });

  it('un chemin direct ne contient que la destination', () => {
    expect(trouverChemin(carte, -30, 0, -20, 0)).toEqual([{ x: -20, z: 0 }]);
  });

  it('contourne le monument d’ouest en est sans traverser un obstacle', () => {
    const chemin = trouverChemin(carte, -20, 0, 20, 0);
    expect(chemin.length).toBeGreaterThan(1);
    expect(chemin.at(-1)).toEqual({ x: 20, z: 0 });
    let x = -20;
    let z = 0;
    for (const p of chemin) {
      expect(visible(x, z, p.x, p.z, carte.obstacles, 0.3)).toBe(true);
      expect(chevauche(p.x, p.z, carte)).toBe(false);
      x = p.x;
      z = p.z;
    }
  });

  it('relie les deux départs de camp', () => {
    const chemin = trouverChemin(carte, -41, 0, 41, 0);
    expect(chemin.length).toBeGreaterThan(1);
  });

  it('est rapide : 300 chemins en moins de 900 ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) trouverChemin(carte, -40 + (i % 7), -20 + (i % 11), 40 - (i % 5), 20 - (i % 13));
    expect(performance.now() - t0).toBeLessThan(900);
  });
});
