// Étape 5 : comportement sous latence (≈ 150 ms aller-retour + gigue), plusieurs salons à la fois.
// Mesure ce que la prédiction apporte réellement : délai entre l'appui et le mouvement affiché.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServeurJeu } from '../serveur';
import { attendre, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest, type ClientTest } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest({ dureePartieS: 6 }); });
afterAll(async () => { await serveur.fermer(); });

const LATENCE = { latenceMs: 75, gigueMs: 20 }; // par sens : RTT ≈ 150–190 ms
const IMMOBILE = () => ({ dx: 0, dz: 0, action: false });

interface Mesure {
  reactionLocaleMs: number;
  reactionVueParAutreMs: number;
  sautMaxDistantM: number;
  corrections: number;
  ecartMaxM: number;
  rttMs: number;
  retardInterpolationMs: number;
  koParSeconde: number;
}

/** Le joueur 0 démarre à t0 ; on mesure quand son écran, puis celui de l'autre, montrent le mouvement. */
async function mesurer(clients: ClientTest[]): Promise<Mesure> {
  const [moteur, temoin] = clients as [ClientTest, ClientTest];
  let intention = IMMOBILE();
  const arrets = [piloter(moteur, () => intention), piloter(temoin, IMMOBILE)];
  await pause(800);
  const idMoteur = moteur.c.id!;
  const x0 = moteur.c.poseLocale(0)!.x;
  const xVu0 = temoin.c.posesDistantes().get(idMoteur)!.x;
  const octets0 = temoin.c.stats.octetsRecus;
  const t0 = performance.now();
  intention = { dx: 1, dz: 0, action: false };
  let reactionLocale = -1;
  let reactionVue = -1;
  let precedentVu = xVu0;
  let sautMax = 0;
  let dernier = t0;
  while (performance.now() - t0 < 1500) {
    const t = performance.now();
    const local = moteur.c.poseLocale((t - dernier) / 1000)!;
    const vu = temoin.c.posesDistantes().get(idMoteur)!;
    dernier = t;
    if (reactionLocale < 0 && local.x - x0 > 0.05) reactionLocale = t - t0;
    if (reactionVue < 0 && vu.x - xVu0 > 0.05) reactionVue = t - t0;
    sautMax = Math.max(sautMax, Math.abs(vu.x - precedentVu));
    precedentVu = vu.x;
    await pause(4);
  }
  const duree = (performance.now() - t0) / 1000;
  for (const f of arrets) f();
  return {
    reactionLocaleMs: Math.round(reactionLocale),
    reactionVueParAutreMs: Math.round(reactionVue),
    sautMaxDistantM: Number(sautMax.toFixed(3)),
    corrections: moteur.c.statsCorrections.corrections,
    ecartMaxM: Number(moteur.c.statsCorrections.ecartMax.toFixed(3)),
    rttMs: Math.round(moteur.c.rtt),
    retardInterpolationMs: Math.round(temoin.c.retardInterpolationMs),
    koParSeconde: Number(((temoin.c.stats.octetsRecus - octets0) / 1024 / duree).toFixed(1)),
  };
}

describe('sous latence (RTT ≈ 150 ms, gigue ±20 ms)', () => {
  it('prédiction : réaction locale immédiate, sans correction ; sans prédiction : un aller-retour d’attente', async () => {
    // Deux salons joués en même temps : l'un avec prédiction, l'autre sans.
    const [avec, sans] = await Promise.all([
      salonAvec(serveur.url, [['P1', 'manifestants'], ['P2', 'forces']], { ...LATENCE, prediction: true }),
      salonAvec(serveur.url, [['N1', 'manifestants'], ['N2', 'forces']], { ...LATENCE, prediction: false }),
    ]);
    await Promise.all([lancer(avec), lancer(sans)]);
    await Promise.all([...avec, ...sans].map((t) => attendre(() => t.c.rtt > 0, 'rtt mesuré', 5000)));
    const [mAvec, mSans] = await Promise.all([mesurer(avec), mesurer(sans)]);
    console.log('\nMesures sous latence simulée (75 ms/sens + gigue 0–20 ms) :');
    console.table({ 'avec prédiction': mAvec, 'sans prédiction': mSans });

    expect(mAvec.rttMs).toBeGreaterThan(140);
    expect(mAvec.reactionLocaleMs).toBeLessThan(90); // 2–3 pas : le temps de parcourir 5 cm depuis l'arrêt
    expect(mSans.reactionLocaleMs).toBeGreaterThan(140); // il faut attendre le serveur
    // Une intention = un pas : la gigue ne crée pas d'écart (0 mesuré machine au repos ; tolérance
    // pour un blocage de la boucle d'événements quand la machine est très chargée).
    expect(mAvec.corrections).toBeLessThanOrEqual(1);
    expect(mAvec.ecartMaxM).toBeLessThan(0.3);
    expect(mAvec.reactionVueParAutreMs).toBeLessThan(400);
    expect(mAvec.sautMaxDistantM).toBeLessThan(0.35); // pas de téléportation visible chez l'autre
    expect(mAvec.koParSeconde).toBeLessThan(20);
    fermerTous([...avec, ...sans]);
  });

  it('même résultat pour tous malgré la latence, dans trois salons simultanés', async () => {
    const salons = await Promise.all([0, 1, 2].map((i) => salonAvec(serveur.url, [[`A${i}`, 'manifestants'], [`B${i}`, 'forces']], LATENCE)));
    await Promise.all(salons.map((s) => lancer(s)));
    const arrets = salons.flatMap(([a, b]) => [
      piloter(a!, () => {
        const p = a!.c.poseLocale(0);
        if (!p) return IMMOBILE();
        const d = Math.hypot(-26 - p.x, -8 - p.z);
        return d < 1 ? IMMOBILE() : { dx: (-26 - p.x) / d, dz: (-8 - p.z) / d, action: false };
      }),
      piloter(b!, () => ({ dx: -0.7, dz: -0.7, action: true })),
    ]);
    await attendre(() => salons.flat().every((t) => t.fins.length === 1), 'fin dans les trois salons', 15000);
    for (const f of arrets) f();
    for (const [a, b] of salons) {
      expect(b!.fins[0]).toEqual(a!.fins[0]);
      expect(a!.fins[0]!.scores.manifestants).toBeGreaterThan(0);
    }
    fermerTous(salons.flat());
  });
});
