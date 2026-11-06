// Intention d'un joueur pour un pas de simulation.
// Le client n'envoie jamais de position : seulement une direction voulue (dans le repère du monde)
// et des boutons. La même validation servira côté serveur (incrément 4).

export interface Intention {
  /** Direction voulue dans le plan (x, z), longueur ≤ 1. */
  dx: number;
  dz: number;
  /** Bouton d'action maintenu (rassembler / cordon). */
  action: boolean;
  /** Bouton spécial (slogan / gaz fictif) : déclenché sur front montant, facultatif. */
  special?: boolean;
}

export const INTENTION_NEUTRE: Intention = Object.freeze({ dx: 0, dz: 0, action: false });

const CLES_AUTORISEES = new Set(['dx', 'dz', 'action', 'special']);

/**
 * Valide une intention reçue d'une source non fiable.
 * Renvoie null si le message est invalide (type, clés inconnues, nombres non finis).
 * La longueur de la direction est ramenée à 1 au maximum.
 */
export function validerIntention(brut: unknown): Intention | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const objet = brut as Record<string, unknown>;
  for (const cle of Object.keys(objet)) if (!CLES_AUTORISEES.has(cle)) return null;
  const { dx, dz, action, special } = objet;
  if (typeof dx !== 'number' || typeof dz !== 'number') return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  if (action !== undefined && typeof action !== 'boolean') return null;
  if (special !== undefined && typeof special !== 'boolean') return null;
  return normaliserIntention({ dx, dz, action: action ?? false, special: special ?? false });
}

/** Ramène la direction à une longueur ≤ 1 et supprime le bruit minuscule. */
export function normaliserIntention(i: Intention): Intention {
  const special = i.special ?? false;
  if (!Number.isFinite(i.dx) || !Number.isFinite(i.dz)) return { dx: 0, dz: 0, action: i.action, special };
  const longueur = Math.hypot(i.dx, i.dz);
  if (longueur < 1e-3) return { dx: 0, dz: 0, action: i.action, special };
  const facteur = longueur > 1 ? 1 / longueur : 1;
  return { dx: i.dx * facteur, dz: i.dz * facteur, action: i.action, special };
}
