import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import type { Intention } from '../src/sim/intention';
import { creerMonde, etape, type Monde } from '../src/sim/monde';
import * as R from '../src/sim/regles';

const neutre: Intention = { dx: 0, dz: 0, action: false };

function jouer(m: Monde, pas: number, intentions: Record<string, Intention> = {}): Monde {
  for (let i = 0; i < pas; i++) m = etape(m, intentions, carte);
  return m;
}

/** Monde à un manifestant joueur posé où l'on veut, sans adversaire. */
function solo(camp: R.Camp, x: number, z: number, autres: Partial<Record<R.Camp, number>> = {}): Monde {
  const m = creerMonde(carte, { campJoueur: camp, reglages: { effectifs: { manif: autres.manif ?? (camp === 'manif' ? 1 : 0), ordre: autres.ordre ?? (camp === 'ordre' ? 1 : 0) } } });
  m.acteurs.joueur = { ...m.acteurs.joueur!, x, z };
  return m;
}

describe('zones et mobilisation', () => {
  it('un manifestant seul dans une zone la capture puis fait monter la mobilisation', () => {
    let m = solo('manif', -22, 0);
    m = jouer(m, 30 * 6);
    const zone = m.zones.find((z) => z.id === 'ouest')!;
    expect(zone.presents.manif).toBe(1);
    expect(zone.tenue).toBe('manif');
    expect(m.partie.mobilisation).toBeGreaterThan(0);
    expect(m.evenements.length).toBe(0);
  });

  it('les forces de l’ordre reprennent une zone tenue', () => {
    let m = solo('ordre', 22, 0);
    m.zones = m.zones.map((z) => (z.id === 'est' ? { ...z, controle: 1, tenue: 'manif' } : z));
    m = jouer(m, 30 * 15);
    expect(m.zones.find((z) => z.id === 'est')!.tenue).toBe('ordre');
  });

  it('la partie se termine quand la cible est atteinte, puis se fige', () => {
    let m = solo('manif', -22, 0);
    m.partie.cibleMobilisation = 3;
    m = jouer(m, 30 * 12);
    expect(m.partie.phase).toBe('terminee');
    expect(m.partie.vainqueur).toBe('manif');
    const tick = m.tick;
    m = jouer(m, 10);
    expect(m.tick).toBe(tick);
  });

  it('le temps écoulé donne la victoire aux forces de l’ordre', () => {
    let m = solo('manif', -40, 0);
    m.partie.duree = 2;
    m = jouer(m, 30 * 2 + 2);
    expect(m.partie.phase).toBe('terminee');
    expect(m.partie.vainqueur).toBe('ordre');
    expect(m.partie.raison).toMatch(/Temps écoulé/);
  });
});

describe('souffle, contact et dispersion', () => {
  it('un manifestant au contact d’un policier perd son souffle et finit hors-jeu, puis revient', () => {
    let m = creerMonde(carte, { campJoueur: 'manif', reglages: { effectifs: { manif: 1, ordre: 1 } } });
    const police = m.acteurs['ordre-0']!;
    m.acteurs.joueur = { ...m.acteurs.joueur!, x: police.x - 1, z: police.z };
    // Le bot policier décide seul ; le joueur reste immobile au contact.
    m = jouer(m, 30 * 3);
    expect(m.acteurs.joueur!.souffle).toBeLessThan(R.SOUFFLE_MAX);
    m = jouer(m, 30 * 12);
    const joueur = m.acteurs.joueur!;
    expect(joueur.stats.dispersions).toBeGreaterThanOrEqual(1);
    expect(m.acteurs['ordre-0']!.stats.neutralisations).toBeGreaterThanOrEqual(1);
  });

  it('un policier seul face à un manifestant ne perd rien ; face à trois, il perd', () => {
    let m = creerMonde(carte, { campJoueur: 'ordre', reglages: { effectifs: { manif: 3, ordre: 1 } } });
    for (const id of ['manif-0', 'manif-1', 'manif-2']) m.acteurs[id] = { ...m.acteurs[id]!, bot: false };
    m.bots = {};
    const j = m.acteurs.joueur!;
    m.acteurs['manif-0'] = { ...m.acteurs['manif-0']!, x: j.x - 1.2, z: j.z };
    m.acteurs['manif-1'] = { ...m.acteurs['manif-1']!, x: j.x - 30, z: j.z };
    m.acteurs['manif-2'] = { ...m.acteurs['manif-2']!, x: j.x - 30, z: j.z + 2 };
    m = jouer(m, 30);
    expect(m.acteurs.joueur!.souffle).toBe(R.SOUFFLE_MAX);
    m.acteurs['manif-1'] = { ...m.acteurs['manif-1']!, x: j.x, z: j.z - 1.2 };
    m.acteurs['manif-2'] = { ...m.acteurs['manif-2']!, x: j.x, z: j.z + 1.2 };
    m = jouer(m, 30);
    expect(m.acteurs.joueur!.souffle).toBeLessThan(R.SOUFFLE_MAX);
  });

  it('le souffle récupère après un délai sans perte, plus vite en groupe', () => {
    let seul = creerMonde(carte, { campJoueur: 'manif', reglages: { effectifs: { manif: 1, ordre: 0 } } });
    seul.acteurs.joueur = { ...seul.acteurs.joueur!, souffle: 40, depuisPerte: 0 };
    seul = jouer(seul, 30 * 4);
    let groupe = creerMonde(carte, { campJoueur: 'manif', reglages: { effectifs: { manif: 3, ordre: 0 } } });
    groupe.acteurs.joueur = { ...groupe.acteurs.joueur!, souffle: 40, depuisPerte: 0 };
    for (const id of ['manif-1', 'manif-2']) groupe.acteurs[id] = { ...groupe.acteurs[id]!, bot: false, x: groupe.acteurs.joueur!.x, z: groupe.acteurs.joueur!.z + (id === 'manif-1' ? 1 : -1) };
    groupe.bots = {};
    groupe = jouer(groupe, 30 * 4);
    expect(seul.acteurs.joueur!.souffle).toBeGreaterThan(40);
    expect(groupe.acteurs.joueur!.souffle).toBeGreaterThan(seul.acteurs.joueur!.souffle);
  });
});

describe('spéciaux', () => {
  it('le gaz fictif crée un nuage devant le policier, consomme une charge et ralentit les manifestants', () => {
    let m = creerMonde(carte, { campJoueur: 'ordre', reglages: { effectifs: { manif: 1, ordre: 1 } } });
    m.acteurs['manif-0'] = { ...m.acteurs['manif-0']!, bot: false };
    m.bots = {};
    const j = m.acteurs.joueur!;
    // Le joueur regarde vers −x (cap π/2) : le nuage apparaît 5 m vers −x.
    m.acteurs['manif-0'] = { ...m.acteurs['manif-0']!, x: j.x - 5, z: j.z };
    m = etape(m, { joueur: { ...neutre, special: true } }, carte);
    expect(m.nuages.length).toBe(1);
    expect(m.nuages[0]!.x).toBeCloseTo(j.x - 5, 0);
    expect(m.acteurs.joueur!.charges).toBe(R.GAZ_CHARGES - 1);
    expect(m.evenements.some((e) => e.type === 'gaz')).toBe(true);
    // Maintenir le bouton ne relance pas (front montant).
    m = etape(m, { joueur: { ...neutre, special: true } }, carte);
    expect(m.nuages.length).toBe(1);
    m = jouer(m, 10, { joueur: neutre });
    expect(m.acteurs['manif-0']!.dansGaz).toBe(true);
    expect(m.acteurs['manif-0']!.souffle).toBeLessThan(R.SOUFFLE_MAX);
    m = jouer(m, 30 * R.GAZ_DUREE, { joueur: neutre });
    expect(m.nuages.length).toBe(0);
  });

  it('le slogan redonne du souffle aux manifestants proches et impose une recharge', () => {
    let m = creerMonde(carte, { campJoueur: 'manif', reglages: { effectifs: { manif: 2, ordre: 0 } } });
    m.acteurs['manif-1'] = { ...m.acteurs['manif-1']!, bot: false, souffle: 30, x: m.acteurs.joueur!.x + 2, z: m.acteurs.joueur!.z };
    m.bots = {};
    m = etape(m, { joueur: { ...neutre, special: true } }, carte);
    expect(m.acteurs['manif-1']!.souffle).toBeCloseTo(30 + R.SLOGAN_SOUFFLE, 0);
    expect(m.acteurs['manif-1']!.elan).toBeGreaterThan(0);
    expect(m.acteurs.joueur!.recharge).toBeGreaterThan(0);
    const avant = m.acteurs['manif-1']!.souffle;
    m = etape(m, { joueur: { ...neutre, special: false } }, carte);
    m = etape(m, { joueur: { ...neutre, special: true } }, carte);
    expect(m.acteurs['manif-1']!.souffle).toBeLessThanOrEqual(avant + 1);
  });
});

describe('déterminisme', () => {
  it('même graine et mêmes intentions → même partie', () => {
    const a = jouer(creerMonde(carte, { campJoueur: null, reglages: { graine: 7 } }), 30 * 20);
    const b = jouer(creerMonde(carte, { campJoueur: null, reglages: { graine: 7 } }), 30 * 20);
    expect(a).toEqual(b);
  });
});
