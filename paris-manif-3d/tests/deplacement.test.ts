import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE, type Carte } from '../src/sim/carte';
import { avancer, chevauche, creerPersonnage, RAYON, VITESSE_MAX } from '../src/sim/deplacement';
import { INTENTION_NEUTRE } from '../src/sim/intention';
import { creerMonde, DT, etape } from '../src/sim/monde';

const vide: Carte = { nom: 'vide', limites: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, obstacles: [], immeubles: [], departs: [{ x: 0, z: 0, cap: 0 }] };
const mur: Carte = {
  ...vide,
  obstacles: [{ id: 'mur', genre: 'barriere', minX: -5, maxX: 5, minZ: -3, maxZ: -2, hauteur: 2 }],
};

function marcher(carte: Carte, dx: number, dz: number, secondes: number, depart = creerPersonnage(0, 0)) {
  let p = depart;
  for (let i = 0; i < Math.round(secondes / DT); i++) p = avancer(p, { dx, dz, action: false }, DT, carte);
  return p;
}

describe('déplacement', () => {
  it('atteint la vitesse maximale sans la dépasser', () => {
    const p = marcher(vide, 1, 0, 2);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(VITESSE_MAX, 2);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(VITESSE_MAX + 1e-9);
  });

  it('parcourt à peu près vitesse × temps', () => {
    const p = marcher(vide, 1, 0, 3);
    expect(p.x).toBeGreaterThan(VITESSE_MAX * 3 - 1);
    expect(p.x).toBeLessThan(VITESSE_MAX * 3);
  });

  it('une intention courte donne une marche (≈ 1,6 m/s)', () => {
    const p = marcher(vide, 0.29, 0, 3);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(1.4);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(1.8);
  });

  it('accélère progressivement (poids) mais freine plus vite', () => {
    const depart = marcher(vide, 1, 0, 0.2);
    expect(Math.hypot(depart.vx, depart.vz)).toBeLessThan(VITESSE_MAX * 0.85);
    let p = marcher(vide, 1, 0, 2);
    for (let i = 0; i < 6; i++) p = avancer(p, INTENTION_NEUTRE, DT, vide); // 0,2 s
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(VITESSE_MAX * 0.2);
  });

  it("s'arrête quand l'intention est neutre", () => {
    let p = marcher(vide, 0, -1, 1);
    for (let i = 0; i < 30; i++) p = avancer(p, INTENTION_NEUTRE, DT, vide);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(0.01);
  });

  it('se tourne vers la direction de marche', () => {
    const p = marcher(vide, 1, 0, 1); // vers +x → cap −π/2
    expect(p.cap).toBeCloseTo(-Math.PI / 2, 2);
  });

  it("ne modifie pas l'état d'entrée", () => {
    const p = creerPersonnage(1, 2, 0.5);
    const copie = { ...p };
    avancer(p, { dx: 1, dz: 1, action: false }, DT, vide);
    expect(p).toEqual(copie);
  });

  it('est déterministe', () => {
    expect(marcher(CARTE_REPUBLIQUE, 0.6, -0.8, 4, creerPersonnage(-30, 5))).toEqual(
      marcher(CARTE_REPUBLIQUE, 0.6, -0.8, 4, creerPersonnage(-30, 5)),
    );
  });
});

describe('collisions', () => {
  it('bloque contre un mur sans le traverser', () => {
    const p = marcher(mur, 0, -1, 3); // fonce vers −z
    expect(p.z).toBeGreaterThanOrEqual(-2 + RAYON - 1e-6);
    expect(p.vz).toBeGreaterThanOrEqual(-1e-6);
    expect(chevauche(p.x, p.z, mur)).toBe(false);
  });

  it('glisse le long du mur en diagonale', () => {
    const p = marcher(mur, 0.7071, -0.7071, 3);
    expect(p.x).toBeGreaterThan(5); // a longé puis dépassé le mur
  });

  it('ne traverse pas à pleine vitesse un obstacle fin (pas de tunnel)', () => {
    const fin: Carte = { ...vide, obstacles: [{ id: 'f', genre: 'barriere', minX: -5, maxX: 5, minZ: 3, maxZ: 3.1, hauteur: 1 }] };
    const p = marcher(fin, 0, 1, 3);
    expect(p.z).toBeLessThan(3);
  });

  it('reste dans les limites de la carte', () => {
    const p = marcher(vide, 1, 1, 30);
    expect(p.x).toBeLessThanOrEqual(50 - RAYON);
    expect(p.z).toBeLessThanOrEqual(50 - RAYON);
  });

  it("ne reste jamais dans un obstacle de la place, quelle que soit la direction", () => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const p = marcher(CARTE_REPUBLIQUE, Math.cos(a), Math.sin(a), 12, creerPersonnage(-36, 0));
      expect(chevauche(p.x, p.z, CARTE_REPUBLIQUE)).toBe(false);
    }
  });

  it('les points de départ sont libres', () => {
    for (const d of CARTE_REPUBLIQUE.departs) expect(chevauche(d.x, d.z, CARTE_REPUBLIQUE)).toBe(false);
  });
});

describe('monde', () => {
  it('avance le tick et arrête un personnage sans intention', () => {
    let m = creerMonde(CARTE_REPUBLIQUE, ['a', 'b']);
    for (let i = 0; i < 30; i++) m = etape(m, { a: { dx: 1, dz: 0, action: false } }, CARTE_REPUBLIQUE);
    expect(m.tick).toBe(30);
    expect(m.personnages.a!.x).toBeGreaterThan(-36);
    expect(m.personnages.b).toEqual(creerMonde(CARTE_REPUBLIQUE, ['a', 'b']).personnages.b);
  });
});
