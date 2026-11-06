// Étapes 2 et 3 : déplacements synchronisés dans les deux sens, mêmes règles, même résultat.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointDepart, ZONES_REPUBLIQUE } from '../../src/sim/objectifs';
import { CARTE_REPUBLIQUE } from '../../src/sim/carte';
import { reglagesParDefaut } from '../../src/sim/regles';
import type { ServeurJeu } from '../serveur';
import { attendre, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest({ dureePartieS: 20 }); });
const DEPART_M = pointDepart('manif', 0, CARTE_REPUBLIQUE);
const DEPART_O = pointDepart('ordre', 0, CARTE_REPUBLIQUE);
const OUEST = ZONES_REPUBLIQUE[0]!;
afterAll(async () => { await serveur.fermer(); });

const IMMOBILE = () => ({ dx: 0, dz: 0, action: false });

describe('partie synchronisée', () => {
  it('les déplacements de chacun sont vus par l’autre, et la prédiction locale colle au serveur', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const idA = a!.c.id!;
    const idB = b!.c.id!;
    const departA = { ...a!.c.poseLocale(0)! };
    expect(departA.x).toBeCloseTo(DEPART_M.x, 5);

    // A court vers +x pendant 1 s, B ne bouge pas.
    let intentionA = { dx: 1, dz: 0, action: true };
    const stopA = piloter(a!, () => intentionA);
    const stopB = piloter(b!, IMMOBILE);
    await pause(1000);
    intentionA = IMMOBILE();
    await pause(700); // arrêt + confirmation serveur

    const localA = a!.c.etatPredit!;
    const serveurA = a!.c.dernierEtat!.m!;
    const vuParB = b!.c.posesDistantes().get(idA)!;
    expect(localA.x - departA.x).toBeGreaterThan(3); // a vraiment couru
    expect(Math.abs(localA.x - serveurA[0])).toBeLessThan(0.005); // prédiction = autorité
    expect(Math.abs(vuParB.x - serveurA[0])).toBeLessThan(0.02); // B voit A au même endroit
    expect(Math.abs(vuParB.z - serveurA[1])).toBeLessThan(0.02);
    expect(Math.abs(b!.c.etatPredit!.x - DEPART_O.x)).toBeLessThan(1e-6); // B n'a pas bougé

    // Dans l'autre sens : B se déplace vers +z, A le voit.
    const zB0 = b!.c.poseLocale(0)!.z;
    const stopB2 = (stopB(), piloter(b!, () => ({ dx: 0, dz: 1, action: false })));
    await pause(800);
    stopB2();
    const stopB3 = piloter(b!, IMMOBILE);
    await pause(700);
    const serveurB = b!.c.dernierEtat!.m!;
    const vuParA = a!.c.posesDistantes().get(idB)!;
    expect(serveurB[1] - zB0).toBeGreaterThan(2);
    expect(Math.abs(vuParA.z - serveurB[1])).toBeLessThan(0.02);
    expect(Math.abs(b!.c.etatPredit!.z - serveurB[1])).toBeLessThan(0.005); // seules les intentions en vol diffèrent
    // Une intention = un pas côté serveur : aucune correction malgré la gigue de la boucle d'événements.
    // (0 mesuré machine au repos ; sous forte charge, un blocage > 330 ms de la boucle d'événements
    // partagée par serveur et clients peut en provoquer une, petite et lissée.)
    for (const t of [a!, b!]) {
      const s = t.c.statsCorrections;
      expect(s.corrections).toBeLessThanOrEqual(Math.max(1, s.reconciliations * 0.02));
      expect(s.ecartMax).toBeLessThan(0.3);
    }
    stopA();
    stopB3();
    fermerTous([a!, b!]);
  });

  it('mêmes objectifs, mêmes scores, même résultat chez tous les joueurs', async () => {
    const [a, b, c] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces'], ['C', 'manifestants']]);
    await lancer([a!, b!, c!]);
    // 2 manifestants contre 1 humain : un bot complète les forces de l'ordre.
    expect(a!.c.partie!.participants.filter((p) => p.bot).map((p) => p.camp)).toEqual(['forces']);
    expect(a!.c.partie!.objectifs.map((o) => o.id)).toEqual(['ouest', 'monument', 'est']);

    // A file vers le parvis ouest et y reste ; les autres ne bougent pas.
    const versObjectif = () => {
      const p = a!.c.poseLocale(0);
      if (!p) return IMMOBILE();
      const dx = OUEST.x - p.x;
      const dz = OUEST.z - p.z;
      const d = Math.hypot(dx, dz);
      return d < 1 ? IMMOBILE() : { dx: dx / d, dz: dz / d, action: false };
    };
    const arrets = [piloter(a!, versObjectif), piloter(b!, IMMOBILE), piloter(c!, IMMOBILE)];
    const botId = a!.c.partie!.participants.find((p) => p.bot)!.id;
    const botDepart = a!.c.dernierEtat!.j[botId]!;
    await attendre(() => a!.c.dernierEtat!.z[0] === 1, 'parvis ouest tenu par les manifestants', 15000);
    // Le bot serveur bouge tout seul.
    const botMaintenant = b!.c.dernierEtat!.j[botId]!;
    expect(Math.hypot(botMaintenant[0] - botDepart[0], botMaintenant[1] - botDepart[1])).toBeGreaterThan(1);

    await attendre(() => a!.fins.length === 1 && b!.fins.length === 1 && c!.fins.length === 1, 'fin de partie', 25000);
    for (const f of arrets) f();
    const [ra, rb, rc] = [a!.fins[0]!, b!.fins[0]!, c!.fins[0]!];
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    expect(ra.scores.manifestants).toBeGreaterThan(0);
    // Règles complètes : les manifestants gagnent à la cible de mobilisation (0,8 × durée), sinon le temps écoulé donne la victoire aux forces de l'ordre.
    expect(ra.gagnant).toBe(ra.scores.manifestants >= reglagesParDefaut({ duree: 20 }).cibleMobilisation ? 'manifestants' : 'forces');
    // Le dernier instantané reçu porte les mêmes scores que le résultat final.
    expect(a!.c.dernierEtat!.s).toEqual([ra.scores.manifestants, ra.scores.forces]);
    expect(a!.c.dernierEtat!.r).toBe(0);
    expect(ra.participants.find((p) => p.nom === 'A')!.points).toBeGreaterThan(0);
    for (const t of [a!, b!, c!]) expect(t.c.salon!.phase).toBe('resultats');
    fermerTous([a!, b!, c!]);
  });
});
