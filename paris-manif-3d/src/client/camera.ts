// Caméra à la troisième personne automatique : logique pure (testable sans navigateur).
// Elle se replace doucement derrière le personnage quand il avance, sans souris.
// La rotation manuelle (touches ou glisser) est facultative et suspend le suivi 2 s.

import type { Obstacle } from '../sim/carte';
import { avant, borner, droite, ecartAngle, lissage, normaliserAngle } from '../sim/math';
import { VITESSE_MAX } from '../sim/deplacement';

export const DISTANCE = 5.4;
export const TANGAGE = 0.27; // radians vers le bas
export const HAUTEUR_VISEE = 1.5;
/** Décalage latéral de la visée (cadrage « par-dessus l'épaule », personnage légèrement à gauche). */
export const DECALAGE_EPAULE = 0.45;
/** Rayon de la « sphère » de caméra : on lance plusieurs rayons pour ne jamais frôler un mur. */
const RAYON_CAMERA = 0.25;
export const PAUSE_APRES_MANUEL = 2; // s
const SUIVI = 1.8; // réactivité du suivi automatique à pleine vitesse (1/s)
const RECENTRAGE = 10;
/**
 * Au-delà de cet écart, on ne suit pas. Les commandes étant relatives à la caméra, suivre un pas de côté
 * ferait tourner la caméra, donc la direction « droite », donc le personnage : il tournerait en rond.
 * On ne suit donc que la composante « avant » (diagonale avant comprise, pas le pas de côté ni le recul).
 */
const ECART_MAX_SUIVI = 0.9;

export interface EtatCamera {
  lacet: number;
  delaiManuel: number;
  recentrage: boolean;
}

export interface EntreeCamera {
  capPerso: number;
  vitessePerso: number;
  /** Rotation manuelle demandée pendant ce pas (radians, signe = sens). */
  rotationManuelle: number;
  recentrer: boolean;
}

export function creerCamera(lacet: number): EtatCamera {
  return { lacet, delaiManuel: 0, recentrage: false };
}

export function majCamera(c: EtatCamera, e: EntreeCamera, dt: number): EtatCamera {
  let { lacet, delaiManuel, recentrage } = c;
  if (e.recentrer) recentrage = true;

  if (e.rotationManuelle !== 0) {
    lacet += e.rotationManuelle;
    delaiManuel = PAUSE_APRES_MANUEL;
    recentrage = false;
  } else if (recentrage) {
    const ecart = ecartAngle(lacet, e.capPerso);
    lacet += ecart * lissage(RECENTRAGE, dt);
    if (Math.abs(ecart) < 0.02) recentrage = false;
  } else if (delaiManuel > 0) {
    delaiManuel = Math.max(0, delaiManuel - dt);
  } else if (e.vitessePerso > 0.5) {
    const ecart = ecartAngle(lacet, e.capPerso);
    if (Math.abs(ecart) < ECART_MAX_SUIVI) {
      const intensite = borner(e.vitessePerso / VITESSE_MAX, 0, 1) * Math.cos(ecart);
      lacet += ecart * lissage(SUIVI * intensite, dt);
    }
  }
  return { lacet: normaliserAngle(lacet), delaiManuel, recentrage };
}

/** Convertit un joystick (jx droite, jy avant, dans [−1, 1]) en direction monde relative à la caméra. */
export function directionMonde(jx: number, jy: number, lacet: number): { dx: number; dz: number } {
  const a = avant(lacet);
  const d = droite(lacet);
  return { dx: a.x * jy + d.x * jx, dz: a.z * jy + d.z * jx };
}

export interface Pose {
  position: { x: number; y: number; z: number };
  cible: { x: number; y: number; z: number };
}

/**
 * Pose de la caméra. `distance` est la distance déjà lissée (voir lisserDistance) ;
 * sans valeur, on prend la distance libre immédiate.
 */
export function poseCamera(px: number, pz: number, lacet: number, obstacles: readonly Obstacle[], distance?: number): Pose {
  const cible = viseeCamera(px, pz, lacet);
  const dir = directionCamera(lacet);
  const d = distance ?? distanceCible(px, pz, lacet, obstacles);
  return { cible, position: { x: cible.x + dir.x * d, y: Math.max(0.5, cible.y + dir.y * d), z: cible.z + dir.z * d } };
}

export function viseeCamera(px: number, pz: number, lacet: number): { x: number; y: number; z: number } {
  const d = droite(lacet);
  return { x: px + d.x * DECALAGE_EPAULE, y: HAUTEUR_VISEE, z: pz + d.z * DECALAGE_EPAULE };
}

function directionCamera(lacet: number): { x: number; y: number; z: number } {
  const a = avant(lacet);
  return { x: -a.x * Math.cos(TANGAGE), y: Math.sin(TANGAGE), z: -a.z * Math.cos(TANGAGE) };
}

/** Distance maximale sans obstacle, testée par 5 rayons (centre + 4 bords) pour éviter les traversées. */
export function distanceCible(px: number, pz: number, lacet: number, obstacles: readonly Obstacle[]): number {
  const cible = viseeCamera(px, pz, lacet);
  const dir = directionCamera(lacet);
  const d = droite(lacet);
  let libre = DISTANCE;
  for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const o = { x: cible.x + d.x * ox * RAYON_CAMERA, y: cible.y + oy * RAYON_CAMERA, z: cible.z + d.z * ox * RAYON_CAMERA };
    libre = Math.min(libre, distanceLibre(o, dir, DISTANCE, obstacles));
  }
  return Math.max(0.6, libre - RAYON_CAMERA);
}

/** Lissage asymétrique : la caméra se rapproche vite (pas de mur traversé) et recule doucement. */
export function lisserDistance(courante: number, cible: number, dt: number): number {
  const vitesse = cible < courante ? 22 : 2.5;
  return courante + (cible - courante) * lissage(vitesse, dt);
}

/** Distance parcourable depuis o dans la direction unitaire dir avant de toucher une boîte (méthode des dalles). */
export function distanceLibre(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  max: number,
  obstacles: readonly Obstacle[],
): number {
  let meilleur = max;
  for (const b of obstacles) {
    let tMin = 0;
    let tMax = meilleur;
    const axes: [number, number, number, number][] = [
      [o.x, dir.x, b.minX, b.maxX],
      [o.y, dir.y, 0, b.hauteur],
      [o.z, dir.z, b.minZ, b.maxZ],
    ];
    let touche = true;
    for (const [orig, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (orig < mn || orig > mx) { touche = false; break; }
        continue;
      }
      let t1 = (mn - orig) / d;
      let t2 = (mx - orig) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) { touche = false; break; }
    }
    if (touche && tMin < meilleur) meilleur = tMin;
  }
  return meilleur;
}
