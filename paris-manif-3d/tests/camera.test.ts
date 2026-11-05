import { describe, expect, it } from 'vitest';
import { creerCamera, directionMonde, distanceLibre, majCamera, PAUSE_APRES_MANUEL, poseCamera, DISTANCE } from '../src/client/camera';
import type { Obstacle } from '../src/sim/carte';
import { ecartAngle } from '../src/sim/math';

const dt = 1 / 60;
function simuler(c: ReturnType<typeof creerCamera>, secondes: number, entree: Parameters<typeof majCamera>[1]) {
  let r = c;
  for (let i = 0; i < secondes / dt; i++) r = majCamera(r, entree, dt);
  return r;
}

describe('caméra automatique', () => {
  it('se replace derrière un personnage qui avance', () => {
    const c = simuler(creerCamera(0), 4, { capPerso: 0.6, vitessePerso: 5.5, rotationManuelle: 0, recentrer: false });
    expect(Math.abs(ecartAngle(c.lacet, 0.6))).toBeLessThan(0.05);
  });

  it('ne suit pas un pas de côté (sinon le personnage tournerait en rond)', () => {
    const c = simuler(creerCamera(0), 3, { capPerso: -Math.PI / 2, vitessePerso: 5.5, rotationManuelle: 0, recentrer: false });
    expect(c.lacet).toBe(0);
  });

  it('ne bouge pas si le personnage est immobile', () => {
    const c = simuler(creerCamera(0), 2, { capPerso: 1.2, vitessePerso: 0, rotationManuelle: 0, recentrer: false });
    expect(c.lacet).toBe(0);
  });

  it('ne tourne pas quand le personnage revient vers la caméra', () => {
    const c = simuler(creerCamera(0), 2, { capPerso: Math.PI, vitessePerso: 5.5, rotationManuelle: 0, recentrer: false });
    expect(c.lacet).toBe(0);
  });

  it('le recentrage replace la caméra même à l’arrêt', () => {
    let c = majCamera(creerCamera(0), { capPerso: 2.5, vitessePerso: 0, rotationManuelle: 0, recentrer: true }, dt);
    c = simuler(c, 1, { capPerso: 2.5, vitessePerso: 0, rotationManuelle: 0, recentrer: false });
    expect(Math.abs(ecartAngle(c.lacet, 2.5))).toBeLessThan(0.03);
    expect(c.recentrage).toBe(false);
  });

  it('la rotation manuelle suspend le suivi automatique puis il reprend', () => {
    let c = majCamera(creerCamera(0), { capPerso: 0, vitessePerso: 5.5, rotationManuelle: 0.5, recentrer: false }, dt);
    expect(c.lacet).toBeCloseTo(0.5, 6);
    const pendant = simuler(c, PAUSE_APRES_MANUEL * 0.9, { capPerso: 0, vitessePerso: 5.5, rotationManuelle: 0, recentrer: false });
    expect(pendant.lacet).toBeCloseTo(0.5, 6);
    c = simuler(c, PAUSE_APRES_MANUEL + 4, { capPerso: 0, vitessePerso: 5.5, rotationManuelle: 0, recentrer: false });
    expect(Math.abs(c.lacet)).toBeLessThan(0.05);
  });
});

describe('direction relative à la caméra', () => {
  it('pousser vers l’avant éloigne de la caméra', () => {
    expect(directionMonde(0, 1, 0).dz).toBeCloseTo(-1);
    const d = directionMonde(0, 1, Math.PI / 2); // caméra tournée : avant = −x
    expect(d.dx).toBeCloseTo(-1);
    expect(d.dz).toBeCloseTo(0);
  });

  it('droite et avant sont perpendiculaires', () => {
    const a = directionMonde(0, 1, 0.7);
    const d = directionMonde(1, 0, 0.7);
    expect(a.dx * d.dx + a.dz * d.dz).toBeCloseTo(0);
  });
});

describe('occlusion de la caméra', () => {
  const mur: Obstacle = { id: 'm', genre: 'immeuble', minX: -10, maxX: 10, minZ: 3, maxZ: 4, hauteur: 20 };

  it('rapproche la caméra derrière un immeuble', () => {
    const pose = poseCamera(0, 0, 0, [mur]); // caméra derrière = vers +z, donc dans le mur
    expect(pose.position.z).toBeLessThan(3);
  });

  it('garde la distance complète sans obstacle', () => {
    const o = { x: 0, y: 1.6, z: 0 };
    expect(distanceLibre(o, { x: 0, y: 0, z: 1 }, DISTANCE, [])).toBe(DISTANCE);
    expect(distanceLibre(o, { x: 0, y: 0, z: 1 }, DISTANCE, [mur])).toBeCloseTo(3);
  });
});
