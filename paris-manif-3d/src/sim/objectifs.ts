// Zones à tenir et points de départ de chaque camp. Données pures, séparées de la carte (décor).

import type { Carte } from './carte';
import type { Camp } from './regles';

export interface DefinitionZone {
  id: string;
  nom: string;
  x: number;
  z: number;
  rayon: number;
}

export const ZONES_REPUBLIQUE: readonly DefinitionZone[] = [
  { id: 'ouest', nom: 'Parvis ouest', x: -22, z: 0, rayon: 6 },
  { id: 'monument', nom: 'Monument', x: 0, z: 0, rayon: 9 },
  { id: 'est', nom: 'Parvis est', x: 22, z: 0, rayon: 6 },
];

/** Zone de départ d'un camp : centre et demi-largeur en z. */
// Les départs évitent les barrières de la carte (à l'ouest : trouée en z ∈ [−4, 4] ; à l'est : barrière en z ∈ [−5, 1]).
export const DEPARTS: Record<Camp, { x: number; z: number; etalement: number; cap: number }> = {
  manif: { x: -41, z: 0, etalement: 4, cap: -Math.PI / 2 },
  ordre: { x: 41, z: 4.5, etalement: 3, cap: Math.PI / 2 },
};

export function dansZone(x: number, z: number, zone: DefinitionZone): boolean {
  const dx = x - zone.x;
  const dz = z - zone.z;
  return dx * dx + dz * dz <= zone.rayon * zone.rayon;
}

/** Point de départ du i-ème membre d'un camp, borné à la carte. */
export function pointDepart(camp: Camp, i: number, carte: Carte): { x: number; z: number; cap: number } {
  const d = DEPARTS[camp];
  const rang = Math.floor(i / 2);
  const cote = i % 2 === 0 ? -1 : 1;
  // Les rangs suivants se placent vers le centre de la place, en quinconce.
  const x = d.x + (camp === 'manif' ? rang * 1.2 : -rang * 1.2);
  const z = d.z + cote * (0.9 + rang * 0.9) * (d.etalement / 4);
  return {
    x: Math.max(carte.limites.minX + 1, Math.min(carte.limites.maxX - 1, x)),
    z: Math.max(carte.limites.minZ + 1, Math.min(carte.limites.maxZ - 1, z)),
    cap: d.cap,
  };
}
