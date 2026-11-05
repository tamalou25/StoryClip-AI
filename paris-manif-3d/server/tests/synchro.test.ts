// Étapes 2 et 3 : déplacements synchronisés dans les deux sens, mêmes règles, même résultat.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServeurJeu } from '../serveur';
import { attendre, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest({ dureePartieS: 6 }); });
afterAll(async () => { await serveur.fermer(); });

const IMMOBILE = () => ({ dx: 0, dz: 0, action: false });

describe('partie synchronisée', () => {
  it('les déplacements de chacun sont vus par l’autre, et la prédiction locale colle au serveur', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const idA = a!.c.id!;
    const idB = b!.c.id!;
    const departA = { ...a!.c.poseLocale(0)! };
    expect(departA.x).toBeCloseTo(-36, 5);

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
    expect(Math.abs(b!.c.etatPredit!.x - 36)).toBeLessThan(1e-6); // B n'a pas bougé

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
    expect(a!.c.statsCorrections.corrections).toBe(0);
    expect(b!.c.statsCorrections.corrections).toBe(0);
    stopA();
    stopB3();
    fermerTous([a!, b!]);
  });

  it('mêmes objectifs, mêmes scores, même résultat chez tous les joueurs', async () => {
    const [a, b, c] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces'], ['C', 'manifestants']]);
    await lancer([a!, b!, c!]);
    // 2 manifestants contre 1 humain : un bot complète les forces de l'ordre.
    expect(a!.c.partie!.participants.filter((p) => p.bot).map((p) => p.camp)).toEqual(['forces']);
    expect(a!.c.partie!.objectifs.map((o) => o.id)).toEqual(['A', 'B', 'C']);

    // A file vers l'objectif A (−26, −8) et y reste ; les autres ne bougent pas.
    const versObjectif = () => {
      const p = a!.c.poseLocale(0);
      if (!p) return IMMOBILE();
      const dx = -26 - p.x;
      const dz = -8 - p.z;
      const d = Math.hypot(dx, dz);
      return d < 1 ? IMMOBILE() : { dx: dx / d, dz: dz / d, action: false };
    };
    const arrets = [piloter(a!, versObjectif), piloter(b!, IMMOBILE), piloter(c!, IMMOBILE)];
    const botId = a!.c.partie!.participants.find((p) => p.bot)!.id;
    const botDepart = a!.c.dernierEtat!.j[botId]!;
    await attendre(() => a!.c.dernierEtat!.z[0] === 1, 'objectif A tenu par les manifestants', 5000);
    // Le bot serveur bouge tout seul.
    const botMaintenant = b!.c.dernierEtat!.j[botId]!;
    expect(Math.hypot(botMaintenant[0] - botDepart[0], botMaintenant[1] - botDepart[1])).toBeGreaterThan(1);

    await attendre(() => a!.fins.length === 1 && b!.fins.length === 1 && c!.fins.length === 1, 'fin de partie', 10000);
    for (const f of arrets) f();
    const [ra, rb, rc] = [a!.fins[0]!, b!.fins[0]!, c!.fins[0]!];
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    expect(ra.scores.manifestants).toBeGreaterThan(0);
    expect(ra.gagnant).toBe(ra.scores.manifestants > ra.scores.forces ? 'manifestants' : ra.scores.forces > ra.scores.manifestants ? 'forces' : 'egalite');
    // Le dernier instantané reçu porte les mêmes scores que le résultat final.
    expect(a!.c.dernierEtat!.s).toEqual([ra.scores.manifestants, ra.scores.forces]);
    expect(a!.c.dernierEtat!.r).toBe(0);
    expect(ra.participants.find((p) => p.nom === 'A')!.points).toBeGreaterThan(0);
    for (const t of [a!, b!, c!]) expect(t.c.salon!.phase).toBe('resultats');
    fermerTous([a!, b!, c!]);
  });
});
