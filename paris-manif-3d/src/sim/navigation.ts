// Navigation des bots : grille d'occupation (1 m) dérivée de la carte, A* 8-directions,
// puis lissage du chemin par visibilité. Pur, déterministe, sans dépendance au rendu.

import type { Carte, Obstacle } from './carte';
import { RAYON } from './deplacement';

const CELLULE = 1; // m
/** Marge ajoutée aux obstacles : rayon du personnage + un peu d'air pour ne pas raser les murs. */
const MARGE = RAYON + 0.25;

export interface Grille {
  minX: number;
  minZ: number;
  colonnes: number;
  lignes: number;
  /** 1 = bloqué. */
  bloque: Uint8Array;
}

const cache = new WeakMap<Carte, Grille>();

export function grillePour(carte: Carte): Grille {
  let g = cache.get(carte);
  if (g) return g;
  g = construireGrille(carte);
  cache.set(carte, g);
  return g;
}

function construireGrille(carte: Carte): Grille {
  const { limites } = carte;
  const minX = limites.minX;
  const minZ = limites.minZ;
  const colonnes = Math.ceil((limites.maxX - limites.minX) / CELLULE);
  const lignes = Math.ceil((limites.maxZ - limites.minZ) / CELLULE);
  const bloque = new Uint8Array(colonnes * lignes);
  for (let l = 0; l < lignes; l++) {
    for (let c = 0; c < colonnes; c++) {
      const x = minX + (c + 0.5) * CELLULE;
      const z = minZ + (l + 0.5) * CELLULE;
      if (x < limites.minX + RAYON || x > limites.maxX - RAYON || z < limites.minZ + RAYON || z > limites.maxZ - RAYON) {
        bloque[l * colonnes + c] = 1;
        continue;
      }
      for (const o of carte.obstacles) {
        if (x > o.minX - MARGE && x < o.maxX + MARGE && z > o.minZ - MARGE && z < o.maxZ + MARGE) {
          bloque[l * colonnes + c] = 1;
          break;
        }
      }
    }
  }
  return { minX, minZ, colonnes, lignes, bloque };
}

function cellule(g: Grille, x: number, z: number): { c: number; l: number } {
  return {
    c: Math.max(0, Math.min(g.colonnes - 1, Math.floor((x - g.minX) / CELLULE))),
    l: Math.max(0, Math.min(g.lignes - 1, Math.floor((z - g.minZ) / CELLULE))),
  };
}

function centre(g: Grille, c: number, l: number): { x: number; z: number } {
  return { x: g.minX + (c + 0.5) * CELLULE, z: g.minZ + (l + 0.5) * CELLULE };
}

export function estBloque(g: Grille, x: number, z: number): boolean {
  const { c, l } = cellule(g, x, z);
  return g.bloque[l * g.colonnes + c] === 1;
}

/** Cellule libre la plus proche (spirale), ou la cellule elle-même. */
function cellulLibre(g: Grille, c0: number, l0: number): { c: number; l: number } {
  if (g.bloque[l0 * g.colonnes + c0] === 0) return { c: c0, l: l0 };
  for (let r = 1; r < 8; r++) {
    for (let dl = -r; dl <= r; dl++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dl), Math.abs(dc)) !== r) continue;
        const c = c0 + dc;
        const l = l0 + dl;
        if (c < 0 || l < 0 || c >= g.colonnes || l >= g.lignes) continue;
        if (g.bloque[l * g.colonnes + c] === 0) return { c, l };
      }
    }
  }
  return { c: c0, l: l0 };
}

/** Segment libre d'obstacles (échantillonnage tous les 0,35 m contre les boîtes élargies). */
export function visible(x0: number, z0: number, x1: number, z1: number, obstacles: readonly Obstacle[], marge = MARGE - 0.1): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(d / 0.35));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    for (const o of obstacles) {
      if (x > o.minX - marge && x < o.maxX + marge && z > o.minZ - marge && z < o.maxZ + marge) return false;
    }
  }
  return true;
}

/**
 * Chemin de (x0, z0) à (x1, z1) : liste de points à suivre (le point d'arrivée inclus), ou [] si
 * aucun chemin. Le premier point n'est pas la position de départ.
 */
export function trouverChemin(carte: Carte, x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] {
  const g = grillePour(carte);
  if (visible(x0, z0, x1, z1, carte.obstacles)) return [{ x: x1, z: z1 }];
  const depart = cellulLibre(g, ...valeurs(cellule(g, x0, z0)));
  const arrivee = cellulLibre(g, ...valeurs(cellule(g, x1, z1)));
  const brut = aEtoile(g, depart, arrivee);
  if (!brut) return [];
  const points = brut.map(([c, l]) => centre(g, c, l));
  points.push({ x: x1, z: z1 });
  return lisser(x0, z0, points, carte.obstacles);
}

function valeurs(c: { c: number; l: number }): [number, number] {
  return [c.c, c.l];
}

function lisser(x0: number, z0: number, points: { x: number; z: number }[], obstacles: readonly Obstacle[]): { x: number; z: number }[] {
  const resultat: { x: number; z: number }[] = [];
  let cx = x0;
  let cz = z0;
  let i = 0;
  while (i < points.length) {
    // Le point le plus lointain encore visible depuis la position courante.
    let j = points.length - 1;
    while (j > i && !visible(cx, cz, points[j]!.x, points[j]!.z, obstacles)) j--;
    const p = points[j]!;
    resultat.push(p);
    cx = p.x;
    cz = p.z;
    i = j + 1;
  }
  return resultat;
}

const VOISINS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function aEtoile(g: Grille, depart: { c: number; l: number }, arrivee: { c: number; l: number }): [number, number][] | null {
  const n = g.colonnes * g.lignes;
  const cout = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const ferme = new Uint8Array(n);
  const iDepart = depart.l * g.colonnes + depart.c;
  const iArrivee = arrivee.l * g.colonnes + arrivee.c;
  const h = (i: number) => {
    const dc = Math.abs((i % g.colonnes) - arrivee.c);
    const dl = Math.abs(Math.floor(i / g.colonnes) - arrivee.l);
    return Math.max(dc, dl) + (Math.SQRT2 - 1) * Math.min(dc, dl);
  };
  // File de priorité binaire (petite, simple).
  const tas: number[] = [];
  const prio: number[] = [];
  const pousser = (i: number, f: number) => {
    tas.push(i);
    prio.push(f);
    let k = tas.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (prio[p]! <= prio[k]!) break;
      [tas[p], tas[k]] = [tas[k]!, tas[p]!];
      [prio[p], prio[k]] = [prio[k]!, prio[p]!];
      k = p;
    }
  };
  const retirer = (): number => {
    const premier = tas[0]!;
    const dernier = tas.pop()!;
    const dp = prio.pop()!;
    if (tas.length > 0) {
      tas[0] = dernier;
      prio[0] = dp;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1;
        const b = a + 1;
        let m = k;
        if (a < tas.length && prio[a]! < prio[m]!) m = a;
        if (b < tas.length && prio[b]! < prio[m]!) m = b;
        if (m === k) break;
        [tas[m], tas[k]] = [tas[k]!, tas[m]!];
        [prio[m], prio[k]] = [prio[k]!, prio[m]!];
        k = m;
      }
    }
    return premier;
  };

  cout[iDepart] = 0;
  pousser(iDepart, h(iDepart));
  while (tas.length > 0) {
    const i = retirer();
    if (ferme[i]) continue;
    ferme[i] = 1;
    if (i === iArrivee) break;
    const c = i % g.colonnes;
    const l = (i - c) / g.colonnes;
    for (const [dc, dl, poids] of VOISINS) {
      const nc = c + dc;
      const nl = l + dl;
      if (nc < 0 || nl < 0 || nc >= g.colonnes || nl >= g.lignes) continue;
      const j = nl * g.colonnes + nc;
      if (g.bloque[j] || ferme[j]) continue;
      // Pas de coupe de coin : les deux cellules adjacentes doivent être libres en diagonale.
      if (dc !== 0 && dl !== 0 && (g.bloque[l * g.colonnes + nc] || g.bloque[nl * g.colonnes + c])) continue;
      const nouveau = cout[i]! + poids;
      if (nouveau < cout[j]!) {
        cout[j] = nouveau;
        parent[j] = i;
        pousser(j, nouveau + h(j));
      }
    }
  }
  if (!ferme[iArrivee]) return null;
  const chemin: [number, number][] = [];
  for (let i = iArrivee; i !== -1 && i !== iDepart; i = parent[i]!) chemin.push([i % g.colonnes, Math.floor(i / g.colonnes)]);
  chemin.reverse();
  return chemin;
}
