// Déplacement et collisions d'un personnage : fonctions pures, sans rendu ni DOM.
// Un personnage est un cercle (rayon RAYON) qui glisse contre des boîtes alignées sur les axes.

import type { Carte, Obstacle } from './carte';
import type { Intention } from './intention';
import { borner, capVers, ecartAngle, lissage, normaliserAngle } from './math';

export const RAYON = 0.4;
export const VITESSE_MAX = 5.6; // m/s : course (joystick ou touches à fond)
export const VITESSE_MARCHE = 1.6; // m/s : intention de longueur ≈ 0,3 (Maj ou joystick peu poussé)
export const ACCELERATION = 7; // réactivité à l'accélération (1/s) : donne du poids au départ
export const FREINAGE = 10; // réactivité au freinage (1/s) : arrêt net mais pas instantané
export const ROTATION = 9; // réactivité du cap (1/s)
/** Passes de résolution (coins et obstacles voisins). Tous les obstacles bloquent : pas de saut. */
const PASSES_COLLISION = 3;

export interface Personnage {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Cap (radians), voir math.ts. */
  cap: number;
}

export function creerPersonnage(x: number, z: number, cap = 0): Personnage {
  return { x, z, vx: 0, vz: 0, cap };
}

/** Avance un personnage d'un pas dt selon son intention. Ne modifie pas l'entrée. vitesseMax permet ralentis et élans. */
export function avancer(p: Personnage, intention: Intention, dt: number, carte: Carte, vitesseMax = VITESSE_MAX): Personnage {
  // 1. Vitesse : on tend vers la vitesse voulue (accélération et freinage doux).
  const cibleX = intention.dx * vitesseMax;
  const cibleZ = intention.dz * vitesseMax;
  const accelere = Math.hypot(cibleX, cibleZ) > Math.hypot(p.vx, p.vz) - 1e-6;
  const k = lissage(accelere ? ACCELERATION : FREINAGE, dt);
  const vx = p.vx + (cibleX - p.vx) * k;
  const vz = p.vz + (cibleZ - p.vz) * k;

  // 2. Cap : le personnage se tourne vers la direction voulue.
  let cap = p.cap;
  if (Math.hypot(intention.dx, intention.dz) > 0.05) {
    const cible = capVers(intention.dx, intention.dz);
    cap = normaliserAngle(cap + ecartAngle(cap, cible) * lissage(ROTATION, dt));
  }

  // 3. Position puis résolution des collisions.
  const resolu = resoudreCollisions(p.x + vx * dt, p.z + vz * dt, vx, vz, carte);
  return { ...resolu, cap };
}

/** Repousse un cercle hors des obstacles et des limites ; annule la vitesse qui entre dans un mur. */
export function resoudreCollisions(
  x0: number,
  z0: number,
  vx0: number,
  vz0: number,
  carte: Carte,
): { x: number; z: number; vx: number; vz: number } {
  let x = x0;
  let z = z0;
  let vx = vx0;
  let vz = vz0;

  for (let passe = 0; passe < PASSES_COLLISION; passe++) {
    let touche = false;
    for (const o of carte.obstacles) {
      const r = repousser(x, z, o);
      if (!r) continue;
      touche = true;
      x += r.nx * r.profondeur;
      z += r.nz * r.profondeur;
      const entrant = vx * r.nx + vz * r.nz;
      if (entrant < 0) {
        vx -= entrant * r.nx;
        vz -= entrant * r.nz;
      }
    }
    if (!touche) break;
  }

  const { limites: l } = carte;
  const bx = borner(x, l.minX + RAYON, l.maxX - RAYON);
  const bz = borner(z, l.minZ + RAYON, l.maxZ - RAYON);
  if (bx !== x) vx = 0;
  if (bz !== z) vz = 0;
  return { x: bx, z: bz, vx, vz };
}

/** Normale et profondeur de pénétration d'un cercle dans une boîte, ou null. */
export function repousser(x: number, z: number, o: Obstacle): { nx: number; nz: number; profondeur: number } | null {
  const px = borner(x, o.minX, o.maxX);
  const pz = borner(z, o.minZ, o.maxZ);
  const dx = x - px;
  const dz = z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > 1e-12) {
    if (d2 >= RAYON * RAYON) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, profondeur: RAYON - d };
  }
  // Centre à l'intérieur de la boîte : sortie par le côté le plus proche.
  const sorties = [
    { nx: -1, nz: 0, p: x - o.minX },
    { nx: 1, nz: 0, p: o.maxX - x },
    { nx: 0, nz: -1, p: z - o.minZ },
    { nx: 0, nz: 1, p: o.maxZ - z },
  ];
  let meilleure = sorties[0]!;
  for (const s of sorties) if (s.p < meilleure.p) meilleure = s;
  return { nx: meilleure.nx, nz: meilleure.nz, profondeur: meilleure.p + RAYON };
}

/** Vrai si le cercle d'un personnage chevauche un obstacle (utilisé par les tests). */
export function chevauche(x: number, z: number, carte: Carte): boolean {
  return carte.obstacles.some((o) => {
    const r = repousser(x, z, o);
    return r !== null && r.profondeur > 1e-6;
  });
}
