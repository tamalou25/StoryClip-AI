// Raccordement : le serveur multijoueur avec les règles complètes de la session gameplay.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReglesPartie } from '../../src/reseau/regles';
import { creerReglesManif, REGLES_MANIF } from '../../src/reseau/regles-manif';
import { FREQUENCE } from '../../src/sim/monde';
import type { ServeurJeu } from '../serveur';
import { attendre, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest } from './outils';

const participants = [
  { id: 'j1', camp: 'manifestants' as const, bot: false },
  { id: 'j2', camp: 'forces' as const, bot: false },
  { id: 'b1', camp: 'forces' as const, bot: true },
];

describe('adaptateur regles-manif (pur)', () => {
  it('place les humains sur des acteurs, garde les bots de la simulation', () => {
    const e = REGLES_MANIF.creer(participants, 60 * FREQUENCE);
    expect(e.monde.ordre).toEqual(['j1', 'j2', 'b1']);
    expect(e.monde.acteurs.j1).toMatchObject({ camp: 'manif', bot: false });
    expect(e.monde.acteurs.b1).toMatchObject({ camp: 'ordre', bot: true });
    expect(Object.keys(e.monde.bots)).toEqual(['b1']);
    expect(REGLES_MANIF.vue(e).restant).toBe(60 * FREQUENCE);
  });

  it('humain absent piloté par l’IA puis rendu ; humain figé immobile', () => {
    const r = creerReglesManif();
    let e = r.creer(participants, 60 * FREQUENCE);
    const depart = { ...e.monde.acteurs.j1! };
    for (let i = 0; i < 90; i++) e = r.etape(e, {}, { automatiques: new Set(['j1']) });
    expect(Math.hypot(e.monde.acteurs.j1!.x - depart.x, e.monde.acteurs.j1!.z - depart.z)).toBeGreaterThan(1);
    expect(e.monde.acteurs.j1!.bot).toBe(false);
    expect(e.monde.bots.j1).toBeUndefined();
    const avant = { ...e.monde.acteurs.j2! };
    e = r.etape(e, { j2: { dx: 1, dz: 0, action: false } }, { figes: new Set(['j2']) });
    expect(e.monde.acteurs.j2!.x).toBe(avant.x);
  });
});

describe('serveur + règles complètes', () => {
  let serveur: ServeurJeu;
  beforeAll(async () => { serveur = await serveurDeTest({ regles: creerReglesManif() as ReglesPartie<unknown>, dureePartieS: 10 }); });
  afterAll(async () => { await serveur.fermer(); });

  it('deux joueurs : déplacements vus par l’autre, même résultat, revanche', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    expect(a!.c.partie!.objectifs.map((o) => o.id)).toEqual(['ouest', 'monument', 'est']);
    const x0 = a!.c.dernierEtat!.m![0];
    const stopA = piloter(a!, () => ({ dx: 1, dz: 0, action: false }));
    const stopB = piloter(b!, () => ({ dx: 0, dz: 0, action: false }));
    await pause(1200);
    const vu = b!.c.dernierEtat!.j[a!.c.id!]!;
    expect(vu[0] - x0).toBeGreaterThan(2);
    expect(Math.abs(vu[0] - a!.c.dernierEtat!.m![0])).toBeLessThan(0.3);
    await attendre(() => a!.fins.length === 1 && b!.fins.length === 1, 'fin', 15000);
    stopA();
    stopB();
    expect(b!.fins[0]).toEqual(a!.fins[0]);
    console.log('résultat règles complètes :', JSON.stringify(a!.fins[0]!.scores), a!.fins[0]!.gagnant, 'corrections A :', a!.c.statsCorrections.corrections);
    a!.c.pret(true);
    b!.c.pret(true);
    await attendre(() => a!.c.partie?.partie === 2 && a!.c.dernierEtat?.s[0] === 0, 'revanche');
    fermerTous([a!, b!]);
  });
});
