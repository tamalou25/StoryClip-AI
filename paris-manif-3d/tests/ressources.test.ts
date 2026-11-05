import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fichiersRessources } from '../src/client/listeRessources';

const RACINE = join(import.meta.dirname, '..', 'public', 'ressources');

function tousLesFichiers(q: 'basse' | 'haute'): string[] {
  const f = fichiersRessources(q);
  return [...Object.values(f.pbr).flat(), f.rameau, f.ciel, f.lampadaire, f.banc, f.statue, f.manifestant, f.passant];
}

describe('ressources stockées dans le projet', () => {
  for (const q of ['basse', 'haute'] as const) {
    it(`tous les fichiers de la qualité ${q} existent et ne sont pas vides`, () => {
      for (const f of tousLesFichiers(q)) {
        const chemin = join(RACINE, f);
        expect(existsSync(chemin), f).toBe(true);
        expect(statSync(chemin).size, f).toBeGreaterThan(100);
      }
    });
  }

  it('la qualité basse est plus légère que la haute', () => {
    const poids = (q: 'basse' | 'haute') => tousLesFichiers(q).reduce((s, f) => s + statSync(join(RACINE, f)).size, 0);
    expect(poids('basse')).toBeLessThan(poids('haute') * 0.6);
  });

  it('chaque source tierce est créditée avec une licence CC0', () => {
    const credits = JSON.parse(readFileSync(join(RACINE, 'CREDITS.json'), 'utf8')) as { id: string; licence: string; url: string }[];
    const ids = credits.map((c) => c.id);
    for (const attendu of ['concrete_tiles_02', 'cobblestone_floor_09', 'asphalt_02', 'bark_platanus', 'beige_wall_001', 'street_lamp_01', 'modular_street_seating', 'gothic_statue', 'kloofendal_48d_partly_cloudy_puresky', 'LeafSet010', 'Ultimate Modular Men (Feb 2022)']) {
      expect(ids, attendu).toContain(attendu);
    }
    for (const c of credits) expect(c.licence).toMatch(/^CC0/);
    expect(existsSync(join(RACINE, 'modeles', 'LICENCE-Quaternius.txt'))).toBe(true);
  });
});
