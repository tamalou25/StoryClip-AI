import { describe, expect, it } from 'vitest';
import { avancerTuto, creerTuto } from '../src/client/tuto';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import { creerMonde, etape } from '../src/sim/monde';

describe('tutoriel interactif', () => {
  it('affiche le premier conseil après un délai, puis le suivant quand le joueur entre dans une zone', () => {
    let m = creerMonde(carte, { campJoueur: 'manif', reglages: { effectifs: { manif: 1, ordre: 1 } } });
    const t = creerTuto();
    const j = () => m.acteurs.joueur!;
    expect(avancerTuto(t, m, j(), 'manif', 0.5)).toBeNull();
    expect(avancerTuto(t, m, j(), 'manif', 1.1)).toMatch(/Objectif/);
    expect(avancerTuto(t, m, j(), 'manif', 1)).toBeNull();
    m.acteurs.joueur = { ...j(), x: -22, z: 0 }; // parvis ouest
    expect(avancerTuto(t, m, j(), 'manif', 0.1)).toBeNull(); // étape validée, la suivante attend son délai
    expect(t.index).toBe(1);
    expect(avancerTuto(t, m, j(), 'manif', 1.2)).toMatch(/Espace/);
    // Rassembler pendant une seconde valide l'étape.
    m.acteurs.joueur = { ...j(), rallie: true };
    for (let i = 0; i < 12 && t.index === 1; i++) avancerTuto(t, m, j(), 'manif', 0.1);
    expect(t.index).toBe(2);
  });

  it('se termine et ne renvoie plus rien ensuite', () => {
    let m = creerMonde(carte, { campJoueur: 'ordre', reglages: { effectifs: { manif: 1, ordre: 1 } } });
    const t = creerTuto();
    let fin = false;
    for (let i = 0; i < 2000 && !fin; i++) {
      m = etape(m, { joueur: { dx: -1, dz: 0, action: true, special: i % 50 === 0 } }, carte);
      const r = avancerTuto(t, m, m.acteurs.joueur!, 'ordre', 1 / 30);
      if (r === 'fin') fin = true;
    }
    expect(fin).toBe(true);
    expect(t.termine).toBe(true);
    expect(avancerTuto(t, m, m.acteurs.joueur!, 'ordre', 1)).toBeNull();
  });
});
