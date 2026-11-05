// Carte compacte « inspirée de la place de la République » en volumes simples.
// Données pures : utilisées par la simulation (collisions) et par le rendu (décor).
// Les proportions sont réduites et stylisées ; ce n'est pas un relevé exact.

export type GenreObstacle = 'socle' | 'statue' | 'arbre' | 'banc' | 'kiosque' | 'immeuble' | 'barriere';

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

export interface Carte {
  nom: string;
  /** Limites jouables : le centre d'un personnage reste dedans. */
  limites: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: Obstacle[];
  departs: { x: number; z: number; cap: number }[];
}

function boite(id: string, genre: GenreObstacle, cx: number, cz: number, lx: number, lz: number, hauteur: number): Obstacle {
  return { id, genre, minX: cx - lx / 2, maxX: cx + lx / 2, minZ: cz - lz / 2, maxZ: cz + lz / 2, hauteur };
}

function construireRepublique(): Carte {
  const obstacles: Obstacle[] = [];

  // Monument central : socle large, statue haute au milieu.
  obstacles.push(boite('socle', 'socle', 0, 0, 7, 7, 1.6));
  obstacles.push(boite('statue', 'statue', 0, 0, 2, 2, 9));

  // Deux alignements d'arbres le long des côtés longs (troncs = petits volumes).
  for (let i = 0; i < 8; i++) {
    const x = -31.5 + i * 9;
    obstacles.push(boite(`arbre-n${i}`, 'arbre', x, -17, 0.9, 0.9, 6));
    obstacles.push(boite(`arbre-s${i}`, 'arbre', x, 17, 0.9, 0.9, 6));
  }

  // Bancs et kiosque : petits obstacles qui créent des couloirs.
  obstacles.push(boite('banc-1', 'banc', -14, -6, 3, 0.8, 0.6));
  obstacles.push(boite('banc-2', 'banc', 14, 6, 3, 0.8, 0.6));
  obstacles.push(boite('banc-3', 'banc', -14, 6, 3, 0.8, 0.6));
  obstacles.push(boite('banc-4', 'banc', 14, -6, 3, 0.8, 0.6));
  obstacles.push(boite('kiosque', 'kiosque', 26, 0, 4, 4, 3.2));

  // Façades autour de la place (hors limites, servent au décor et à la caméra).
  const hauteursNord = [17, 19, 16, 20, 18];
  hauteursNord.forEach((h, i) => obstacles.push(boite(`imm-n${i}`, 'immeuble', -36 + i * 18, -31, 16, 8, h)));
  hauteursNord.forEach((h, i) => obstacles.push(boite(`imm-s${i}`, 'immeuble', -36 + i * 18, 31, 16, 8, h + 1)));
  obstacles.push(boite('imm-o', 'immeuble', -50, 0, 8, 30, 18));
  obstacles.push(boite('imm-e', 'immeuble', 50, 0, 8, 30, 19));

  return {
    nom: 'République (compacte)',
    limites: { minX: -44, maxX: 44, minZ: -25, maxZ: 25 },
    obstacles,
    departs: [
      { x: -36, z: 0, cap: -Math.PI / 2 }, // regarde vers +x (vers le monument)
      { x: 36, z: 0, cap: Math.PI / 2 },
    ],
  };
}

export const CARTE_REPUBLIQUE: Carte = construireRepublique();
