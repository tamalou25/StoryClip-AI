// Petits outils mathématiques partagés par la simulation et le client.
// Repère : plan horizontal (x, z), y vers le haut (convention PlayCanvas).
// Un cap θ (radians) regarde dans la direction (−sin θ, −cos θ) : θ = 0 regarde vers −z.

export const TAU = Math.PI * 2;

export function borner(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Ramène un angle dans ]−π, π]. */
export function normaliserAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Plus petit écart signé de a vers b. */
export function ecartAngle(a: number, b: number): number {
  return normaliserAngle(b - a);
}

/** Direction « avant » d'un cap. */
export function avant(cap: number): { x: number; z: number } {
  return { x: -Math.sin(cap), z: -Math.cos(cap) };
}

/** Direction « droite » d'un cap. */
export function droite(cap: number): { x: number; z: number } {
  return { x: Math.cos(cap), z: -Math.sin(cap) };
}

/** Cap qui regarde dans la direction (dx, dz). */
export function capVers(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Facteur de lissage exponentiel indépendant de la fréquence d'images. */
export function lissage(vitesse: number, dt: number): number {
  return 1 - Math.exp(-vitesse * dt);
}
