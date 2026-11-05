// État complet de la simulation et pas fixe.
// Même code en solo (navigateur) et, plus tard, sur le serveur autoritaire.

import type { Carte } from './carte';
import { avancer, creerPersonnage, type Personnage } from './deplacement';
import { INTENTION_NEUTRE, type Intention } from './intention';

export const FREQUENCE = 30; // pas de simulation par seconde
export const DT = 1 / FREQUENCE;

export interface Monde {
  tick: number;
  personnages: Record<string, Personnage>;
}

export function creerMonde(carte: Carte, ids: string[]): Monde {
  const personnages: Record<string, Personnage> = {};
  ids.forEach((id, i) => {
    const depart = carte.departs[i % carte.departs.length]!;
    personnages[id] = creerPersonnage(depart.x, depart.z, depart.cap);
  });
  return { tick: 0, personnages };
}

/** Un pas fixe. Un personnage sans intention reçue s'arrête. Ne modifie pas l'entrée. */
export function etape(monde: Monde, intentions: Readonly<Record<string, Intention>>, carte: Carte): Monde {
  const personnages: Record<string, Personnage> = {};
  for (const [id, p] of Object.entries(monde.personnages)) {
    personnages[id] = avancer(p, intentions[id] ?? INTENTION_NEUTRE, DT, carte);
  }
  return { tick: monde.tick + 1, personnages };
}
