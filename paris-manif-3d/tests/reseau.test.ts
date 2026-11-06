// Modules réseau purs : validation du protocole, noms, codes, règles provisoires, prédiction, interpolation.

import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE } from '../src/sim/carte';
import { chevauche, creerPersonnage } from '../src/sim/deplacement';
import { FREQUENCE } from '../src/sim/monde';
import { HorlogeServeur, TamponInterpolation, type EchantillonDistant } from '../src/reseau/interpolation';
import { Predicteur } from '../src/reseau/prediction';
import { decoderMessageClient, nettoyerNom, normaliserCode, validerMessageClient } from '../src/reseau/protocole';
import { OBJECTIFS_REPUBLIQUE, REGLES_ZONES, type EtatZones } from '../src/reseau/regles-zones';

describe('protocole', () => {
  it('accepte les messages bien formés et normalise les intentions', () => {
    expect(validerMessageClient({ t: 'creer', v: 1, nom: 'A', camp: 'forces' })).toEqual({ t: 'creer', v: 1, nom: 'A', camp: 'forces' });
    const i = validerMessageClient({ t: 'i', s: 3, dx: 3, dz: 4 }) as { dx: number; dz: number; a: boolean };
    expect(i).toMatchObject({ t: 'i', s: 3, a: false });
    expect(i.dx).toBeCloseTo(0.6, 12);
    expect(i.dz).toBeCloseTo(0.8, 12);
    expect(validerMessageClient({ t: 'profil', camp: 'manifestants' })).toEqual({ t: 'profil', camp: 'manifestants' });
    expect(validerMessageClient({ t: 'i', s: 4, dx: 0, dz: 0, p: true })).toEqual({ t: 'i', s: 4, dx: 0, dz: 0, a: false, p: true });
    expect(validerMessageClient({ t: 'i', s: 4, dx: 0, dz: 0, p: 1 })).toBeNull();
  });

  it.each([
    ['tableau', []],
    ['type inconnu', { t: 'tricher' }],
    ['prototype', { t: '__proto__' }],
    ['clé en trop', { t: 'demarrer', salon: 'ABCDE' }],
    ['clé manquante', { t: 'pret' }],
    ['camp inconnu', { t: 'creer', v: 1, nom: 'A', camp: 'police' }],
    ['nom trop long', { t: 'creer', v: 1, nom: 'x'.repeat(65), camp: 'forces' }],
    ['NaN', { t: 'i', s: 1, dx: NaN, dz: 0 }],
    ['Infinity', { t: 'i', s: 1, dx: Infinity, dz: 0 }],
    ['séquence négative', { t: 'i', s: -1, dx: 0, dz: 0 }],
    ['séquence décimale', { t: 'i', s: 1.5, dx: 0, dz: 0 }],
    ['action non booléenne', { t: 'i', s: 1, dx: 0, dz: 0, a: 1 }],
    ['profil vide', { t: 'profil' }],
  ])('refuse : %s', (_nom, brut) => {
    expect(validerMessageClient(brut)).toBeNull();
  });

  it('décode du texte non fiable sans exception', () => {
    expect(decoderMessageClient('{')).toBeNull();
    expect(decoderMessageClient('x'.repeat(600))).toBeNull();
    expect(decoderMessageClient('{"t":"ping","c":1}')).toEqual({ t: 'ping', c: 1 });
  });

  it('nettoie les pseudonymes', () => {
    expect(nettoyerNom('  Gary   B. ')).toBe('Gary B.');
    expect(nettoyerNom('a‮b\u0000c​d')).toBe('abcd'); // inversion bidi, nul, largeur nulle
    expect(nettoyerNom('<img src=x>')).toBe('<img src=x>'); // conservé tel quel : affiché en textContent
    expect(Array.from(nettoyerNom('é'.repeat(40)))).toHaveLength(16);
    expect(nettoyerNom('\u0000​')).toBe('');
  });

  it('normalise les codes saisis', () => {
    expect(normaliserCode('ab-c d2')).toBe('ABCD2');
    expect(normaliserCode('ABCD')).toBeNull();
    expect(normaliserCode('ABCD0')).toBeNull(); // 0 exclu (confusion avec O)
    expect(normaliserCode('ABCDEF')).toBeNull();
  });
});

describe('règles provisoires (zones)', () => {
  const participants = [
    { id: 'j1', camp: 'manifestants' as const, bot: false },
    { id: 'j2', camp: 'forces' as const, bot: false },
  ];

  it('objectifs et départs hors des obstacles, dans les limites', () => {
    for (const o of OBJECTIFS_REPUBLIQUE) expect(chevauche(o.x, o.z, CARTE_REPUBLIQUE)).toBe(false);
    const e = REGLES_ZONES.creer(participants, 300);
    for (const p of Object.values(e.personnages)) expect(chevauche(p.x, p.z, CARTE_REPUBLIQUE)).toBe(false);
  });

  it('un objectif tenu rapporte 1 point par seconde ; contesté, il ne rapporte rien', () => {
    let e: EtatZones = REGLES_ZONES.creer(participants, 10 * FREQUENCE);
    const o = OBJECTIFS_REPUBLIQUE[0]!;
    // On place directement les personnages (test des règles, pas du déplacement).
    e = { ...e, personnages: { ...e.personnages, j1: creerPersonnage(o.x, o.z) } };
    for (let i = 0; i < 2 * FREQUENCE; i++) e = REGLES_ZONES.etape(e, {});
    expect(REGLES_ZONES.vue(e).scores).toEqual({ manifestants: 2, forces: 0 });
    expect(REGLES_ZONES.vue(e).objectifs[0]).toBe(1);
    e = { ...e, personnages: { ...e.personnages, j2: creerPersonnage(o.x + 1, o.z) } };
    for (let i = 0; i < FREQUENCE; i++) e = REGLES_ZONES.etape(e, {});
    expect(REGLES_ZONES.vue(e).objectifs[0]).toBe(3);
    expect(REGLES_ZONES.vue(e).scores.manifestants).toBe(2);
  });

  it('fin, vainqueur et points par participant ; déterministe', () => {
    const jouer = () => {
      let e = REGLES_ZONES.creer([...participants, { id: 'b1', camp: 'forces', bot: true }], 20 * FREQUENCE);
      // b1 : bot de complément ; j2 : humain absent, piloté par l'IA des règles.
      while (!REGLES_ZONES.resultat(e)) e = REGLES_ZONES.etape(e, { j1: { dx: 0.3, dz: -0.2, action: false } }, { automatiques: new Set(['j2']) });
      return REGLES_ZONES.resultat(e)!;
    };
    const r = jouer();
    expect(r).toEqual(jouer());
    expect(r.scores.forces).toBeGreaterThan(0); // les bots prennent des objectifs
    expect(r.gagnant).toBe(r.scores.manifestants > r.scores.forces ? 'manifestants' : r.scores.forces > r.scores.manifestants ? 'forces' : 'egalite');
  });

  it('un personnage figé ne bouge pas pendant le pas', () => {
    const e0 = REGLES_ZONES.creer(participants, 100);
    const e1 = REGLES_ZONES.etape(e0, { j1: { dx: 1, dz: 0, action: true }, j2: { dx: -1, dz: 0, action: false } }, { figes: new Set(['j1']) });
    expect(e1.personnages.j1).toEqual(e0.personnages.j1);
    expect(e1.personnages.j2!.x).toBeLessThan(e0.personnages.j2!.x);
  });
});

describe('prédiction et réconciliation', () => {
  const deplacer = REGLES_ZONES.deplacer;
  const avant = { dx: 1, dz: 0, action: false };

  it('rejoue les intentions non confirmées : aucun écart si le serveur a appliqué les mêmes', () => {
    const p = new Predicteur(deplacer);
    p.reconcilier(0, creerPersonnage(0, -20));
    let serveur = creerPersonnage(0, -20);
    for (let s = 1; s <= 10; s++) p.appliquer(s, avant);
    for (let s = 1; s <= 6; s++) serveur = deplacer(serveur, avant);
    p.reconcilier(6, serveur); // le serveur a traité 6 intentions sur 10
    expect(p.stats.corrections).toBe(0);
    expect(p.nonConfirmees).toBe(4);
  });

  it('écart corrigé sans saut visuel, puis amorti', () => {
    const p = new Predicteur(deplacer);
    p.reconcilier(0, creerPersonnage(0, -20));
    for (let s = 1; s <= 5; s++) p.appliquer(s, avant);
    const avantCorrection = p.pose(1, 0)!;
    p.reconcilier(5, creerPersonnage(0.5, -20)); // le serveur dit autre chose (ex. collision)
    const apres = p.pose(1, 0)!;
    expect(apres.x).toBeCloseTo(avantCorrection.x, 9); // pas de saut à l'image suivante
    let x = apres.x;
    for (let i = 0; i < 30; i++) x = p.pose(1, 1 / 60)!.x;
    expect(Math.abs(x - p.etat!.x)).toBeLessThan(0.01); // rejoint l'état serveur en ~0,5 s
    expect(p.stats.corrections).toBe(1);
  });
});

describe('interpolation des distants', () => {
  const e = (x: number): Map<string, EchantillonDistant> => new Map([['b', { x, z: 0, cap: 0, vitesse: 1, action: false }]]);

  it('interpole entre deux instantanés et extrapole brièvement', () => {
    const t = new TamponInterpolation();
    t.ajouter(10, e(0));
    t.ajouter(11, e(1));
    t.ajouter(11, e(99)); // doublon ignoré
    expect(t.echantillonner(10.25).get('b')!.x).toBeCloseTo(0.25);
    expect(t.echantillonner(12).get('b')!.x).toBeCloseTo(2);
    expect(t.echantillonner(30).get('b')!.x).toBeCloseTo(4); // extrapolation bornée à 3 ticks
  });

  it('l’horloge suit le tick serveur et mesure la gigue', () => {
    const h = new HorlogeServeur();
    // Paquets toutes les 33,3 ms, retard 50 ms ± 0–20 ms.
    let graine = 1;
    const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
    for (let k = 1; k <= 300; k++) h.observer(k, (k / FREQUENCE) * 1000 + 50 + alea() * 20);
    const t = (300 / FREQUENCE) * 1000 + 60;
    expect(Math.abs(h.tickEstime(t) - 300)).toBeLessThan(2.5);
    expect(h.retardRendu).toBeGreaterThanOrEqual(1);
    expect(h.retardRendu).toBeLessThan(3);
  });
});
