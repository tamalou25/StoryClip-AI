// Carte compacte « inspirée de la place de la République » : données pures, partagées par
// la simulation (collisions) et le rendu (décor). Proportions réduites et stylisées, pas un relevé exact.
// Repères : place piétonne 88 × 50 m, chaussée de 9 m, façades à |z| = 34 et |x| = 58.

export type GenreObstacle = 'socle' | 'arbre' | 'banc' | 'lampadaire' | 'colonne' | 'barriere' | 'immeuble' | 'passant';

/** Boîte alignée sur les axes, posée au sol. */
export interface Obstacle {
  id: string;
  genre: GenreObstacle;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  hauteur: number;
}

/** Immeuble haussmannien : façade tournée vers la place. */
export interface Immeuble {
  id: string;
  /** Centre de la façade (au sol) et orientation de sa normale vers la place. */
  x: number;
  z: number;
  longueur: number;
  profondeur: number;
  etages: number; // étages courants au-dessus du rez-de-chaussée
  orientation: 'nord' | 'sud' | 'est' | 'ouest'; // direction vers laquelle regarde la façade
  graine: number;
}

export interface Carte {
  nom: string;
  /** Limites jouables : le centre d'un personnage reste dedans. */
  limites: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: Obstacle[];
  immeubles: Immeuble[];
  /** Passants immobiles (décor vivant) ; ils bloquent comme des obstacles. */
  passants: { x: number; z: number; regard: number; variante: number }[];
  departs: { x: number; z: number; cap: number }[];
}

function boite(id: string, genre: GenreObstacle, cx: number, cz: number, lx: number, lz: number, hauteur: number): Obstacle {
  return { id, genre, minX: cx - lx / 2, maxX: cx + lx / 2, minZ: cz - lz / 2, maxZ: cz + lz / 2, hauteur };
}

export const RANGEES_ARBRES_Z = 17;
export const ARBRES_X = [-31.5, -22.5, -13.5, -4.5, 4.5, 13.5, 22.5, 31.5];

function construireRepublique(): Carte {
  const obstacles: Obstacle[] = [];

  // Monument central : emmarchement 9 × 9 m (la partie qui bloque).
  obstacles.push(boite('socle', 'socle', 0, 0, 9, 9, 1.1));

  // Deux alignements de platanes.
  for (const [i, x] of ARBRES_X.entries()) {
    obstacles.push(boite(`arbre-n${i}`, 'arbre', x, -RANGEES_ARBRES_Z, 0.7, 0.7, 7));
    obstacles.push(boite(`arbre-s${i}`, 'arbre', x, RANGEES_ARBRES_Z, 0.7, 0.7, 7));
  }

  // Bancs face au centre, entre les arbres (modèle de 2,4 × 0,7 m).
  for (const x of [-27, -9, 9, 27]) {
    obstacles.push(boite(`banc-n${x}`, 'banc', x, -15.4, 2.4, 0.7, 0.85));
    obstacles.push(boite(`banc-s${x}`, 'banc', x, 15.4, 2.4, 0.7, 0.85));
  }

  // Passants : à l'écart des axes de déplacement principaux.
  const passants = [
    { x: 24.4, z: 7.0, regard: -2.2, variante: 0 },
    { x: -9.6, z: 13.5, regard: -Math.PI / 2, variante: 1 },
    { x: -8.3, z: 13.5, regard: Math.PI / 2, variante: 2 },
    { x: 12.5, z: -9.5, regard: 0.9, variante: 3 },
  ];
  for (const [i, p] of passants.entries()) obstacles.push(boite(`passant${i}`, 'passant', p.x, p.z, 0.6, 0.6, 1.8));

  // Lampadaires : autour du monument et le long des allées.
  for (const [x, z] of [[-7.5, -7.5], [7.5, -7.5], [-7.5, 7.5], [7.5, 7.5], [-36, -11], [36, -11], [-36, 11], [36, 11], [-18, -11], [18, 11]] as const) {
    obstacles.push(boite(`lampe${x}_${z}`, 'lampadaire', x, z, 0.36, 0.36, 4.6));
  }

  // Colonne d'affichage (affiches fictives).
  obstacles.push(boite('colonne', 'colonne', 26, 5, 1.3, 1.3, 3.4));

  // Barrières métalliques mobiles (rangées de 2 m) : couverts et couloirs.
  for (const [id, cx, cz, lx, lz] of [
    ['bar-o1', -39, -6, 0.5, 4],
    ['bar-o2', -39, 6, 0.5, 4],
    ['bar-e1', 39, -2, 0.5, 6],
    ['bar-c1', -18, 4, 4, 0.5],
    ['bar-c2', 16, -4.5, 4, 0.5],
  ] as const) {
    obstacles.push(boite(id, 'barriere', cx, cz, lx, lz, 1.1));
  }

  // Façades : immeubles continus, interrompus par deux rues de chaque côté.
  const immeubles: Immeuble[] = [];
  const longueurs = [21, 18, 24, 18, 21];
  let graine = 1;
  for (const orientation of ['sud', 'nord'] as const) {
    const z = orientation === 'sud' ? -34 : 34; // la façade nord de la place regarde vers le sud
    let x = -55;
    longueurs.forEach((l, i) => {
      const rue = i === 1 || i === 3 ? 7 : 0;
      x += rue;
      immeubles.push({ id: `imm-${orientation}${i}`, x: x + l / 2, z, longueur: l, profondeur: 12, etages: 5, orientation, graine: graine++ });
      x += l;
    });
  }
  immeubles.push({ id: 'imm-est', x: 58, z: 0, longueur: 54, profondeur: 12, etages: 5, orientation: 'ouest', graine: graine++ });
  immeubles.push({ id: 'imm-ouest', x: -58, z: 0, longueur: 54, profondeur: 12, etages: 5, orientation: 'est', graine: graine++ });

  // Les immeubles bloquent aussi (caméra) ; ils sont hors limites jouables.
  for (const im of immeubles) {
    const versX = im.orientation === 'est' || im.orientation === 'ouest';
    const c = centreCorps(im);
    const lx = versX ? im.profondeur : im.longueur;
    const lz = versX ? im.longueur : im.profondeur;
    obstacles.push(boite(im.id, 'immeuble', c.x, c.z, lx, lz, hauteurCorniche(im) + 4));
  }

  return {
    nom: 'République (compacte)',
    limites: { minX: -44, maxX: 44, minZ: -25, maxZ: 25 },
    obstacles,
    immeubles,
    passants,
    departs: [
      { x: -34, z: 0, cap: -Math.PI / 2 }, // regarde vers +x (vers le monument)
      { x: 34, z: 0, cap: Math.PI / 2 },
    ],
  };
}

/** Centre du corps de bâtiment (derrière la façade, côté opposé à la place). */
export function centreCorps(im: Immeuble): { x: number; z: number } {
  const d = im.profondeur / 2;
  switch (im.orientation) {
    case 'sud': return { x: im.x, z: im.z - d }; // façade regarde +z, corps vers −z
    case 'nord': return { x: im.x, z: im.z + d };
    case 'est': return { x: im.x - d, z: im.z };
    case 'ouest': return { x: im.x + d, z: im.z };
  }
}

/** Hauteur de la corniche principale (rez-de-chaussée 4,6 m + étages de 3,1 m). */
export function hauteurCorniche(im: Immeuble): number {
  return 4.6 + im.etages * 3.1;
}

export const CARTE_REPUBLIQUE: Carte = construireRepublique();
