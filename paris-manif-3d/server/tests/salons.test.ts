// Étape 1 : création, code court, rejoindre, noms/camps, préparation, erreurs compréhensibles.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALPHABET_CODE, LONGUEUR_CODE } from '../../src/reseau/protocole';
import type { ServeurJeu } from '../serveur';
import { attendre, client, fermerTous, lancer, salonAvec, serveurDeTest, type ClientTest } from './outils';

let serveur: ServeurJeu;
beforeAll(async () => { serveur = await serveurDeTest(); });
afterAll(async () => { await serveur.fermer(); });

describe('salon privé', () => {
  it('deux clients indépendants rejoignent le même salon avec un code court', async () => {
    const hote = client(serveur.url);
    hote.c.creer('Alice', 'manifestants');
    await attendre(() => hote.c.salon !== null, 'salon créé');
    const code = hote.c.session!.code;
    expect(code).toHaveLength(LONGUEUR_CODE);
    for (const ch of code) expect(ALPHABET_CODE).toContain(ch);

    const invite = client(serveur.url);
    invite.c.rejoindre(code.toLowerCase().replace(/(..)/, '$1-'), 'Bob', 'forces'); // saisie tolérante : minuscules, tiret
    await attendre(() => hote.c.salon?.joueurs.length === 2 && invite.c.salon?.joueurs.length === 2, 'les deux se voient');

    for (const t of [hote, invite]) {
      const v = t.c.salon!;
      expect(v.code).toBe(code);
      expect(v.phase).toBe('attente');
      expect(v.joueurs.map((j) => [j.nom, j.camp, j.presence, j.hote])).toEqual([
        ['Alice', 'manifestants', 'connecte', true],
        ['Bob', 'forces', 'connecte', false],
      ]);
    }
    expect(hote.c.id).not.toBe(invite.c.id);
    fermerTous([hote, invite]);
  });

  it('nom nettoyé et dédoublonné, camp et préparation visibles par tous', async () => {
    const [a, b] = await salonAvec(serveur.url, [['  Zoé‮\u0000  ', 'manifestants'], ['zoé', 'manifestants']]);
    expect(a!.c.salon!.joueurs.map((j) => j.nom)).toEqual(['Zoé', 'zoé 2']);
    b!.c.profil({ camp: 'forces', nom: 'Yann' });
    b!.c.pret(true);
    await attendre(() => a!.c.salon!.joueurs[1]?.camp === 'forces' && a!.c.salon!.joueurs[1]?.pret === true && a!.c.salon!.joueurs[1]?.nom === 'Yann', 'changement vu par l’hôte');
    expect(a!.c.salon!.attente).toMatch(/1 joueur pas encore prêt/);
    a!.c.pret(true);
    await attendre(() => a!.c.salon!.attente === null, 'conditions réunies');
    fermerTous([a!, b!]);
  });

  it('seul l’hôte lance, et seulement quand tout le monde est prêt', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    b!.c.demarrer();
    await attendre(() => b!.erreurs.some((e) => e.code === 'non_hote' && !e.fatal), 'refus non hôte');
    a!.c.demarrer();
    await attendre(() => a!.erreurs.some((e) => e.code === 'conditions'), 'refus pas prêts');
    expect(a!.c.salon!.phase).toBe('attente');
    await lancer([a!, b!]);
    expect(a!.debuts).toBe(1);
    expect(b!.c.partie!.participants.map((p) => [p.nom, p.camp, p.bot])).toEqual([['A', 'manifestants', false], ['B', 'forces', false]]);
    fermerTous([a!, b!]);
  });

  it('erreurs : salon introuvable, code mal formé, salon complet, partie déjà commencée', async () => {
    const perdu = client(serveur.url);
    perdu.c.rejoindre('ZZZZZ', 'X');
    await attendre(() => perdu.erreurs.length > 0, 'erreur introuvable');
    expect(perdu.erreurs[0]).toEqual({ code: 'introuvable', fatal: true });
    expect(perdu.c.etatConnexion).toBe('hors_ligne');

    const malForme = client(serveur.url);
    malForme.c.rejoindre('<b>!', 'X');
    await attendre(() => malForme.erreurs.length > 0, 'erreur code mal formé');
    expect(malForme.erreurs[0]!.code).toBe('introuvable');

    const quatre = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces'], ['C', 'manifestants'], ['D', 'forces']]);
    const cinquieme = client(serveur.url);
    cinquieme.c.rejoindre(quatre[0]!.c.session!.code, 'E');
    await attendre(() => cinquieme.erreurs.length > 0, 'erreur complet');
    expect(cinquieme.erreurs[0]).toEqual({ code: 'complet', fatal: true });

    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await lancer([a!, b!]);
    const tard = client(serveur.url);
    tard.c.rejoindre(a!.c.session!.code, 'Retard');
    await attendre(() => tard.erreurs.length > 0, 'erreur commencée');
    expect(tard.erreurs[0]).toEqual({ code: 'commencee', fatal: true });
    fermerTous([...quatre, a!, b!]);
  });

  it('serveur indisponible : erreur claire, pas de boucle de reconnexion', async () => {
    const t: ClientTest = client('ws://127.0.0.1:1/ws');
    t.c.creer('Seul', 'manifestants');
    await attendre(() => t.erreurs.length > 0, 'erreur indisponible');
    expect(t.erreurs).toEqual([{ code: 'indisponible', fatal: true }]);
    expect(t.c.etatConnexion).toBe('hors_ligne');
  });

  it('ping/pong : le client mesure un aller-retour', async () => {
    const [a, b] = await salonAvec(serveur.url, [['A', 'manifestants'], ['B', 'forces']]);
    await attendre(() => a!.c.rtt > 0, 'rtt mesuré', 4000);
    expect(a!.c.rtt).toBeLessThan(200);
    fermerTous([a!, b!]);
  });
});
