// Messages invalides, taille, fréquence, appartenance au salon, limites par IP, origine, isolation des salons.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VITESSE_MAX } from '../../src/sim/deplacement';
import { FERMETURE, type MessageServeur } from '../../src/reseau/protocole';
import type { ServeurJeu } from '../serveur';
import { attendre, client, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest, socketBrute } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest({ dureePartieS: 30 }); });
afterAll(async () => { await serveur.fermer(); });

const erreurs = (recus: MessageServeur[]) => recus.filter((m): m is Extract<MessageServeur, { t: 'erreur' }> => m.t === 'erreur');

describe('validation des messages', () => {
  it('messages invalides refusés, puis expulsion, sans perturber une partie voisine', async () => {
    // Une partie en cours dans un autre salon, avec un joueur qui court.
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const stopA = piloter(a!, () => ({ dx: 1, dz: 0, action: false }));
    const stopB = piloter(b!, () => ({ dx: 0, dz: 0, action: false }));

    const pirate = await socketBrute(serveur.url);
    pirate.ws.send(JSON.stringify({ t: 'creer', v: 1, nom: 'Pirate', camp: 'forces' }));
    await attendre(() => pirate.recus.some((m) => m.t === 'bienvenue'), 'pirate dans son propre salon');
    const invalides = [
      'pas du json',
      '[]',
      'null',
      '{"t":"inconnu"}',
      '{"t":"pret"}',
      '{"t":"pret","pret":"oui"}',
      '{"t":"pret","pret":true,"salon":"AAAAA"}', // clé en trop (tentative de viser un autre salon)
      '{"t":"i","s":1,"dx":1e999,"dz":0}', // Infinity
      '{"t":"i","s":-1,"dx":0,"dz":0}',
      '{"t":"i","s":1.5,"dx":0,"dz":0}',
      '{"t":"profil"}',
      '{"t":"rejoindre","v":1,"code":"AAAAA","nom":"x"}', // déjà dans un salon
      '{"t":"__proto__"}',
      '{"t":"ping","c":"x"}',
    ];
    for (const m of invalides) pirate.ws.send(m);
    await attendre(() => erreurs(pirate.recus).some((e) => e.code === 'invalide' && !e.fatal), 'avertissement « invalide »');
    expect(pirate.ws.readyState).toBe(pirate.ws.OPEN); // 14 messages : pas encore expulsé

    const k = a!.c.dernierEtat!.k;
    for (let i = 0; i < 10; i++) pirate.ws.send('{"t":"x"}');
    expect(await pirate.fermeture).toBe(FERMETURE.invalides);

    // La partie voisine a continué normalement pendant tout ce temps.
    await attendre(() => a!.c.dernierEtat!.k > k + 10, 'partie voisine toujours vivante');
    expect(a!.c.salon!.phase).toBe('partie');
    expect(a!.c.etatConnexion).toBe('en_ligne');
    stopA();
    stopB();
    fermerTous([a!, b!]);
  });

  it('message trop gros : socket fermée (1009)', async () => {
    const s = await socketBrute(serveur.url);
    s.ws.send(JSON.stringify({ t: 'creer', v: 1, nom: 'x'.repeat(600), camp: 'forces' }));
    expect(await s.fermeture).toBe(1009);
  });

  it('débit limité : avertissement puis expulsion d’un client qui inonde', async () => {
    const s = await socketBrute(serveur.url);
    for (let i = 0; i < 300; i++) s.ws.send(JSON.stringify({ t: 'ping', c: i }));
    expect(await s.fermeture).toBe(FERMETURE.abus);
    expect(erreurs(s.recus).some((e) => e.code === 'trop_rapide')).toBe(true);
    expect(s.recus.filter((m) => m.t === 'pong').length).toBeLessThanOrEqual(61); // seau de 60 + recharge
  });

  it('une intention de longueur 50 est ramenée à 1 : la vitesse reste bornée par le serveur', async () => {
    const hote = client(serveur.url);
    hote.c.creer('Témoin', 'manifestants');
    await attendre(() => hote.c.salon !== null, 'salon');
    const triche = await socketBrute(serveur.url);
    triche.ws.send(JSON.stringify({ t: 'rejoindre', v: 1, code: hote.c.session!.code, nom: 'Triche' }));
    await attendre(() => hote.c.salon!.joueurs.length === 2, 'tricheur arrivé');
    const idTriche = hote.c.salon!.joueurs[1]!.id;
    triche.ws.send('{"t":"pret","pret":true}');
    hote.c.pret(true);
    await attendre(() => hote.c.salon!.attente === null, 'prêts');
    hote.c.demarrer();
    await attendre(() => hote.c.salon!.phase === 'partie', 'partie');
    let s = 0;
    let vMax = 0;
    const fin = Date.now() + 1500;
    while (Date.now() < fin) {
      triche.ws.send(JSON.stringify({ t: 'i', s: ++s, dx: -50, dz: 0, a: false }));
      const v = hote.c.dernierEtat?.j[idTriche]?.[3];
      if (v !== undefined) vMax = Math.max(vMax, v);
      await pause(33);
    }
    expect(vMax).toBeGreaterThan(5);
    expect(vMax).toBeLessThanOrEqual(VITESSE_MAX + 0.05);
    // Rejouer d'anciens numéros ou en envoyer en rafale ne fait pas avancer plus vite.
    const x0 = hote.c.dernierEtat!.j[idTriche]![0];
    for (let i = 0; i < 50; i++) triche.ws.send(JSON.stringify({ t: 'i', s: 1, dx: -1, dz: 0, a: false }));
    await pause(400);
    expect(Math.abs(hote.c.dernierEtat!.j[idTriche]![0] - x0)).toBeLessThan(VITESSE_MAX * 0.45);
    triche.ws.close();
    hote.c.fermer();
  });

  it('avant d’avoir rejoint un salon, seuls créer / rejoindre / reprendre / ping sont acceptés', async () => {
    const s = await socketBrute(serveur.url);
    s.ws.send('{"t":"demarrer"}');
    s.ws.send('{"t":"i","s":1,"dx":1,"dz":0,"a":false}');
    await attendre(() => erreurs(s.recus).length > 0, 'refus');
    expect(erreurs(s.recus)[0]!.code).toBe('invalide');
    s.ws.send('{"t":"reprendre","v":1,"code":"ABCDE","jeton":"0000"}');
    await attendre(() => erreurs(s.recus).some((e) => e.code === 'introuvable'), 'reprise refusée');
    s.ws.send('{"t":"creer","v":99,"nom":"x","camp":"forces"}');
    await attendre(() => erreurs(s.recus).some((e) => e.code === 'version'), 'version refusée');
    s.ws.close();
  });
});

describe('limites par adresse et origine', () => {
  it('connexions simultanées et créations de salon limitées par IP', async () => {
    const petit = await serveurDeTest({ connexionsParIp: 3, creationsParMinute: 2 });
    const ouvertes = await Promise.all([0, 1, 2].map(() => socketBrute(petit.url)));
    await expect(socketBrute(petit.url)).rejects.toThrow(/429/);
    for (const [i, s] of ouvertes.entries()) s.ws.send(JSON.stringify({ t: 'creer', v: 1, nom: `C${i}`, camp: 'forces' }));
    await attendre(() => erreurs(ouvertes[2]!.recus).length > 0 || ouvertes.every((s) => s.recus.length > 0), 'réponses');
    await pause(100);
    const codes = ouvertes.map((s) => s.recus.find((m) => m.t === 'bienvenue' || m.t === 'erreur')!);
    expect(codes.filter((m) => m.t === 'bienvenue')).toHaveLength(2);
    expect(codes.filter((m) => m.t === 'erreur' && m.code === 'limite')).toHaveLength(1);
    for (const s of ouvertes) s.ws.close();
    await petit.fermer();
  });

  it('origine vérifiée quand PM3D_ORIGINES est défini', async () => {
    const strict = await serveurDeTest({ origines: ['https://jeu.exemple'] });
    await expect(socketBrute(strict.url, { origin: 'https://pirate.exemple' })).rejects.toThrow(/403/);
    const ok = await socketBrute(strict.url, { origin: 'https://jeu.exemple' });
    ok.ws.close();
    await strict.fermer();
  });
});

describe('isolation de plusieurs salons', () => {
  it('4 salons en parallèle : chacun ne voit que ses joueurs, ses mouvements et son résultat', async () => {
    const directions = [[1, 0], [0, 1], [0, -1], [0, 0]] as const;
    const salons = await Promise.all(directions.map((_, i) => salonAvec(serveur.url, [[`H${i}`, 'manifestants'], [`I${i}`, 'forces']])));
    const codes = salons.map((s) => s[0]!.c.session!.code);
    expect(new Set(codes).size).toBe(4);
    await Promise.all(salons.map((s) => lancer(s)));
    const arrets = salons.flatMap((s, i) => [
      piloter(s[0]!, () => ({ dx: directions[i]![0], dz: directions[i]![1], action: false })),
      piloter(s[1]!, () => ({ dx: 0, dz: 0, action: false })),
    ]);
    await pause(1000);
    for (const [i, [h, inv]] of salons.entries()) {
      // Participants : exactement les deux joueurs de ce salon.
      expect(inv!.c.partie!.participants.map((p) => p.nom)).toEqual([`H${i}`, `I${i}`]);
      expect(inv!.c.salon!.code).toBe(codes[i]);
      // Ce que l'invité voit de son hôte suit la direction propre à ce salon.
      const vu = inv!.c.dernierEtat!.j[h!.c.id!]!;
      const [dx, dz] = directions[i]!;
      const depl = { x: vu[0] - -36, z: vu[1] - -1.5 };
      if (dx !== 0) expect(Math.sign(depl.x)).toBe(dx);
      else expect(Math.abs(depl.x)).toBeLessThan(0.01);
      if (dz !== 0) expect(Math.sign(depl.z)).toBe(dz);
      else expect(Math.abs(depl.z)).toBeLessThan(0.01);
      expect(Object.keys(inv!.c.dernierEtat!.j)).toEqual([h!.c.id]);
    }
    for (const f of arrets) f();
    // Un départ dans le salon 0 ne change rien ailleurs.
    salons[0]![1]!.c.quitter();
    await attendre(() => salons[0]![0]!.c.salon!.joueurs.some((j) => j.presence === 'parti'), 'départ vu dans le salon 0');
    for (const s of salons.slice(1)) expect(s[0]!.c.salon!.joueurs.every((j) => j.presence === 'connecte')).toBe(true);
    fermerTous(salons.flat());
  });
});
