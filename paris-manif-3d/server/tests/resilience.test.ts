// Étape 4 : déconnexion, reconnexion, départs, hôte, revanche sans état résiduel.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../src/reseau/client';
import { ZONES_REPUBLIQUE } from '../../src/sim/objectifs';
import type { ServeurJeu } from '../serveur';
import { attendre, client, fermerTous, lancer, pause, piloter, salonAvec, serveurDeTest, socketBrute } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest({ dureePartieS: 12, graceS: 2 }); });
const OUEST = ZONES_REPUBLIQUE[0]!;
afterAll(async () => { await serveur.fermer(); });

const IMMOBILE = () => ({ dx: 0, dz: 0, action: false });
const presence = (t: { c: { salon: { joueurs: { id: string; presence: string }[] } | null } }, id: string) =>
  t.c.salon?.joueurs.find((j) => j.id === id)?.presence;

describe('déconnexions et reconnexions', () => {
  it('coupure réseau en partie : place gardée, bot en intérim, reconnexion automatique et reprise des commandes', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const idB = b!.c.id!;
    const stopA = piloter(a!, IMMOBILE);
    let intentionB = IMMOBILE();
    const stopB = piloter(b!, () => intentionB);
    await pause(200);
    const avant = a!.c.dernierEtat!.j[idB]!;

    b!.c.couper(); // comme une perte de réseau
    await attendre(() => presence(a!, idB) === 'reconnexion', 'A voit B en reconnexion');
    await attendre(() => b!.erreurs.some((e) => e.code === 'interrompue' && !e.fatal), 'B informé de la coupure');
    // Pendant l'absence, l'IA des règles pilote le personnage de B (décision toutes les 0,3–0,9 s).
    await pause(1500);
    const pendant = a!.c.dernierEtat!.j[idB]!;
    expect(Math.hypot(pendant[0] - avant[0], pendant[1] - avant[1])).toBeGreaterThan(0.3);

    await attendre(() => presence(a!, idB) === 'connecte' && b!.c.etatConnexion === 'en_ligne', 'B reconnecté', 6000);
    expect(b!.debuts).toBe(2); // état complet renvoyé à la reprise
    expect(b!.c.id).toBe(idB); // même place, même personnage
    // B reprend la main : il part vers −z et A le voit.
    await attendre(() => b!.c.etatPredit !== null, 'prédiction réinitialisée');
    const z0 = a!.c.dernierEtat!.j[idB]![1];
    intentionB = { dx: 0, dz: -1, action: false };
    await attendre(() => a!.c.dernierEtat!.j[idB]![1] < z0 - 1, 'A voit B obéir à nouveau à ses commandes', 4000);
    stopA();
    stopB();
    fermerTous([a!, b!]);
  });

  it('socket morte sans fermeture (ping sans réponse) : détectée et traitée comme une déconnexion', async () => {
    const hote = client(serveur.url);
    hote.c.creer('Hôte', 'manifestants');
    await attendre(() => hote.c.salon !== null, 'salon');
    const brute = await socketBrute(serveur.url, {}, false); // ne répond pas aux pings du serveur
    brute.ws.send(JSON.stringify({ t: 'rejoindre', v: 1, code: hote.c.session!.code, nom: 'Fantôme' }));
    await attendre(() => hote.c.salon!.joueurs.length === 2, 'fantôme arrivé');
    const id = hote.c.salon!.joueurs[1]!.id;
    const code = await brute.fermeture;
    expect(code).toBe(1006); // coupée par le serveur (terminate), sans poignée de main
    await attendre(() => presence(hote, id) !== 'connecte', 'fantôme marqué absent');
    hote.c.fermer();
  });

  it('créateur déconnecté dans le salon : l’hôte passe au suivant, le créateur revient dans le délai', async () => {
    let memoire: Session | null = null;
    const stockage = { lire: () => memoire, ecrire: (s: Session | null) => { memoire = s; } };
    const createur = client(serveur.url, { stockage });
    createur.c.creer('Créa', 'manifestants');
    await attendre(() => createur.c.salon !== null, 'salon');
    const invite = client(serveur.url);
    invite.c.rejoindre(createur.c.session!.code, 'Invité');
    await attendre(() => createur.c.salon!.joueurs.length === 2, 'invité arrivé');
    const idCrea = createur.c.id!;

    createur.c.fermer(); // onglet fermé (sans « Quitter »)
    await attendre(() => invite.c.salon!.joueurs.find((j) => j.hote)?.nom === 'Invité', 'hôte transféré');
    expect(presence(invite, idCrea)).toBe('reconnexion');

    // Rechargement de page : nouvelle instance qui retrouve la session mémorisée.
    const recharge = client(serveur.url, { stockage });
    expect(recharge.c.reprendre()).toBe(true);
    await attendre(() => presence(invite, idCrea) === 'connecte', 'créateur revenu');
    expect(recharge.c.id).toBe(idCrea);
    expect(invite.c.salon!.joueurs.find((j) => j.hote)?.nom).toBe('Invité'); // l'hôte ne change plus
    fermerTous([recharge, invite]);
  });

  it('délai dépassé : place libérée dans le salon, et la reprise est refusée clairement', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    const sessionB = { ...b!.c.session! };
    b!.c.fermer();
    await attendre(() => a!.c.salon!.joueurs.length === 1, 'place libérée après le délai', 5000);
    let memoire: Session | null = sessionB;
    const tard = client(serveur.url, { stockage: { lire: () => memoire, ecrire: (s) => { memoire = s; } } });
    tard.c.reprendre();
    await attendre(() => tard.erreurs.length > 0, 'refus');
    expect(tard.erreurs.at(-1)).toEqual({ code: 'jeton', fatal: true });
    expect(memoire).toBeNull(); // session oubliée : pas de boucle de reprise
    fermerTous([a!]);
  });

  it('départ volontaire en partie : remplacé par un bot, la partie continue jusqu’au résultat', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const idB = b!.c.id!;
    const stopA = piloter(a!, IMMOBILE);
    b!.c.quitter();
    await attendre(() => presence(a!, idB) === 'parti', 'A voit B parti');
    const k = a!.c.dernierEtat!.k;
    await attendre(() => a!.c.dernierEtat!.k > k + 30, 'la partie continue');
    await attendre(() => a!.fins.length === 1, 'résultat', 20000);
    stopA();
    const r = a!.fins[0]!;
    expect(r.participants.find((p) => p.id === idB)).toMatchObject({ nom: 'B', bot: true });
    expect(a!.c.salon!.joueurs.map((j) => j.id)).toEqual([a!.c.id]); // B n'est plus dans le salon
    expect(b!.c.etatConnexion).toBe('hors_ligne');
    fermerTous([a!]);
  });

  it('tout le monde part : salon supprimé, son code ne mène plus nulle part', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    const code = a!.c.session!.code;
    a!.c.quitter();
    b!.c.quitter();
    await attendre(() => !serveur.salons.has(code), 'salon supprimé');
    const t = client(serveur.url);
    t.c.rejoindre(code, 'Curieux');
    await attendre(() => t.erreurs.length > 0, 'erreur');
    expect(t.erreurs[0]!.code).toBe('introuvable');
  });
});

describe('revanche', () => {
  it('vote unanime → nouvelle partie avec un état neuf (positions, scores, minuteur, objectifs)', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const etatInitial = { ...a!.c.dernierEtat! };
    // A court vers l'objectif A et y marque des points.
    const stopA = piloter(a!, () => {
      const p = a!.c.poseLocale(0);
      if (!p) return IMMOBILE();
      const d = Math.hypot(OUEST.x - p.x, OUEST.z - p.z);
      return d < 1 ? IMMOBILE() : { dx: (OUEST.x - p.x) / d, dz: (OUEST.z - p.z) / d, action: false };
    });
    const stopB = piloter(b!, () => ({ dx: -1, dz: 0, action: false })); // B court jusqu'à la fin
    await attendre(() => a!.fins.length === 1 && b!.fins.length === 1, 'fin de la partie 1', 20000);
    stopA();
    stopB();
    expect(a!.fins[0]!.scores.manifestants).toBeGreaterThan(0);

    a!.c.pret(true);
    await attendre(() => b!.c.salon!.attente?.startsWith('Revanche : 1 vote') === true, 'B voit le vote de A');
    expect(b!.c.salon!.phase).toBe('resultats');
    b!.c.pret(true);
    await attendre(() => [a!, b!].every((t) => t.c.partie?.partie === 2 && t.c.dernierEtat !== null), 'partie 2 lancée');

    for (const t of [a!, b!]) {
      const e = t.c.dernierEtat!;
      expect(e.s).toEqual([0, 0]);
      expect(e.z).toEqual([0, 0, 0]);
      expect(e.r).toBe(etatInitial.r);
      expect(t.c.resultat).toBeNull();
    }
    // Chacun est revenu à son point de départ, immobile, même B qui courait à la fin.
    expect(a!.c.dernierEtat!.m!.slice(0, 4)).toEqual(etatInitial.m!.slice(0, 4));
    expect(a!.c.dernierEtat!.j[b!.c.id!]).toEqual(etatInitial.j[b!.c.id!]);
    expect(a!.c.salon!.partie).toBe(2);
    // Aucune intention de la partie 1 n'est rejouée : personne ne bouge sans nouvelle commande.
    await attendre(() => a!.c.salon!.phase === 'partie', 'fin du compte à rebours');
    await pause(300);
    expect(a!.c.dernierEtat!.j[b!.c.id!]!.slice(0, 2)).toEqual(etatInitial.j[b!.c.id!]!.slice(0, 2));
    fermerTous([a!, b!]);
  });

  it('un joueur qui part aux résultats ne bloque pas la revanche des autres', async () => {
    const [a, b, c] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces'], ['C', 'forces']]);
    await lancer([a!, b!, c!]);
    await attendre(() => a!.fins.length === 1, 'fin', 20000);
    a!.c.pret(true);
    b!.c.pret(true);
    c!.c.quitter(); // C ne vote pas et s'en va
    await attendre(() => a!.c.partie?.partie === 2 && b!.c.partie?.partie === 2, 'revanche à deux');
    expect(a!.c.partie!.participants.map((p) => p.nom)).toEqual(['A', 'B']);
    fermerTous([a!, b!]);
  });
});
