// Générateur pseudo-aléatoire déterministe (mulberry32, domaine public).
// La graine vit dans l'état du monde : même graine + mêmes intentions = même partie (serveur, tests).

export interface Alea {
  etat: number;
}

export function creerAlea(graine: number): Alea {
  return { etat: graine >>> 0 };
}

/** Nombre dans [0, 1[. Fait avancer l'état (mutation volontaire : l'état est un petit objet copié par étape). */
export function tirer(a: Alea): number {
  a.etat = (a.etat + 0x6d2b79f5) >>> 0;
  let t = a.etat;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Nombre dans [min, max[. */
export function entre(a: Alea, min: number, max: number): number {
  return min + tirer(a) * (max - min);
}

/** Entier dans [0, n[. */
export function entier(a: Alea, n: number): number {
  return Math.floor(tirer(a) * n);
}
