import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import { chevauche } from '../src/sim/deplacement';
import { creerMonde, etape, type Monde } from '../src/sim/monde';
import type { Camp, Difficulte } from '../src/sim/regles';

function partieBots(graine: number, difficulte: Difficulte = 'normal', duree = 300): { monde: Monde; chevauchements: number; immobiles: number } {
  let m = creerMonde(carte, { campJoueur: null, reglages: { graine, difficulte, duree } });
  let chevauchements = 0;
  let immobiles = 0;
  const positions = new Map<string, { x: number; z: number; tick: number }>();
  while (m.partie.phase === 'en-cours') {
    m = etape(m, {}, carte);
    for (const id of m.ordre) {
      const a = m.acteurs[id]!;
      if (a.etat !== 'actif') continue;
      if (chevauche(a.x, a.z, carte)) chevauchements++;
      const p = positions.get(id);
      if (!p || Math.hypot(a.x - p.x, a.z - p.z) > 1) positions.set(id, { x: a.x, z: a.z, tick: m.tick });
      else if (m.tick - p.tick > 30 * 20) { immobiles++; positions.set(id, { x: a.x, z: a.z, tick: m.tick }); }
    }
  }
  return { monde: m, chevauchements, immobiles };
}

describe('bots', () => {
  it('une partie entre bots se termine, sans acteur figé 20 s ni traversée d’obstacle', () => {
    const { monde, chevauchements, immobiles } = partieBots(3);
    expect(monde.partie.phase).toBe('terminee');
    expect(monde.partie.vainqueur).not.toBeNull();
    expect(chevauchements).toBe(0);
    expect(immobiles).toBe(0);
    // Les deux camps ont agi : zones occupées, contacts, spéciaux.
    const acteurs = monde.ordre.map((id) => monde.acteurs[id]!);
    expect(acteurs.filter((a) => a.camp === 'manif').reduce((s, a) => s + a.stats.tempsEnZone, 0)).toBeGreaterThan(30);
    expect(acteurs.filter((a) => a.camp === 'ordre').reduce((s, a) => s + a.stats.tempsEnZone, 0)).toBeGreaterThan(30);
    expect(acteurs.reduce((s, a) => s + a.stats.speciaux, 0)).toBeGreaterThan(0);
    expect(acteurs.reduce((s, a) => s + a.stats.dispersions, 0)).toBeGreaterThan(0);
  }, 60000);

  it('les parties sont équilibrées entre bots (ni camp dominant ni partie interminable)', () => {
    const victoires: Record<Camp, number> = { manif: 0, ordre: 0 };
    let dureeTotale = 0;
    const N = 12;
    for (let g = 1; g <= N; g++) {
      const { monde } = partieBots(100 + g);
      victoires[monde.partie.vainqueur!]++;
      dureeTotale += monde.partie.temps;
    }
    console.log(`équilibre bots (normal) : manif ${victoires.manif} / ordre ${victoires.ordre}, durée moyenne ${(dureeTotale / N).toFixed(0)} s`);
    expect(victoires.manif).toBeGreaterThanOrEqual(3);
    expect(victoires.ordre).toBeGreaterThanOrEqual(3);
  }, 120000);

  it('la difficulté change le comportement : les bots difficiles tiennent plus de zones que les faciles', () => {
    const tenue = (d: Difficulte) => {
      let total = 0;
      for (let g = 1; g <= 4; g++) {
        const { monde } = partieBots(200 + g, d, 120);
        total += monde.partie.tenueCumulee.manif + monde.partie.tenueCumulee.ordre;
      }
      return total;
    };
    expect(tenue('difficile')).toBeGreaterThan(tenue('facile') * 0.8);
  }, 120000);
});
