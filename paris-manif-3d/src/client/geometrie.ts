// Maillages simples avec UV exprimés en mètres : la texture garde la même échelle quelle que soit la taille.

import * as pc from 'playcanvas';

const INVERSER_V = true; // PlayCanvas place v = 0 en haut de l'image (pas de retournement des canvas)

class Constructeur {
  positions: number[] = [];
  normales: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /** Quadrilatère a-b-c-d (sens antihoraire vu de face), UV en mètres. */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[][]): void {
    const base = this.positions.length / 3;
    for (const [p, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]], [d, uv[3]]] as [number[], number[]][]) {
      this.positions.push(p[0]!, p[1]!, p[2]!);
      this.normales.push(n[0]!, n[1]!, n[2]!);
      this.uvs.push(t[0]!, INVERSER_V ? -t[1]! : t[1]!);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  maillage(device: pc.GraphicsDevice): pc.Mesh {
    const g = new pc.Geometry();
    g.positions = this.positions;
    g.normals = this.normales;
    g.uvs = this.uvs;
    g.indices = this.indices;
    g.calculateTangents();
    return pc.Mesh.fromGeometry(device, g);
  }
}

/** Boîte centrée sur l'origine (base en y = 0), UV en mètres sur chaque face. */
export function boite(device: pc.GraphicsDevice, lx: number, ly: number, lz: number, sansDessous = true): pc.Mesh {
  const k = new Constructeur();
  const x = lx / 2;
  const z = lz / 2;
  // Avant (+z)
  k.quad([-x, 0, z], [x, 0, z], [x, ly, z], [-x, ly, z], [0, 0, 1], [[0, 0], [lx, 0], [lx, ly], [0, ly]]);
  // Arrière (−z)
  k.quad([x, 0, -z], [-x, 0, -z], [-x, ly, -z], [x, ly, -z], [0, 0, -1], [[0, 0], [lx, 0], [lx, ly], [0, ly]]);
  // Droite (+x)
  k.quad([x, 0, z], [x, 0, -z], [x, ly, -z], [x, ly, z], [1, 0, 0], [[0, 0], [lz, 0], [lz, ly], [0, ly]]);
  // Gauche (−x)
  k.quad([-x, 0, -z], [-x, 0, z], [-x, ly, z], [-x, ly, -z], [-1, 0, 0], [[0, 0], [lz, 0], [lz, ly], [0, ly]]);
  // Dessus
  k.quad([-x, ly, z], [x, ly, z], [x, ly, -z], [-x, ly, -z], [0, 1, 0], [[-x, z], [x, z], [x, -z], [-x, -z]]);
  if (!sansDessous) k.quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, -1, 0], [[-x, -z], [x, -z], [x, z], [-x, z]]);
  return k.maillage(device);
}

/** Rectangle vertical (plan XY) tourné vers +z, de (0,0) à (l,h). UV en mètres décalables. */
export function panneau(device: pc.GraphicsDevice, l: number, h: number, u0 = 0, v0 = 0): pc.Mesh {
  const k = new Constructeur();
  k.quad([0, 0, 0], [l, 0, 0], [l, h, 0], [0, h, 0], [0, 0, 1], [[u0, v0], [u0 + l, v0], [u0 + l, v0 + h], [u0, v0 + h]]);
  return k.maillage(device);
}

/** Sol horizontal de (minX, minZ) à (maxX, maxZ) à la hauteur y, UV = coordonnées monde. */
export function sol(device: pc.GraphicsDevice, minX: number, minZ: number, maxX: number, maxZ: number, y = 0): pc.Mesh {
  const k = new Constructeur();
  k.quad([minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ], [minX, y, minZ], [0, 1, 0], [[minX, -maxZ], [maxX, -maxZ], [maxX, -minZ], [minX, -minZ]]);
  return k.maillage(device);
}

/**
 * Toit à la Mansart vu en coupe : brisis raide (≈ 75°) puis terrasson presque plat.
 * Extrudé le long de x (longueur l), profondeur p, centré sur l'origine, base en y = 0.
 */
export function mansarde(device: pc.GraphicsDevice, l: number, p: number, hBrisis = 3.2, retrait = 1.0, hTerrasson = 0.9): pc.Mesh {
  const k = new Constructeur();
  const x = l / 2;
  const z = p / 2;
  const zi = z - retrait;
  const pente = Math.hypot(retrait, hBrisis);
  const n1 = [0, retrait / pente, hBrisis / pente];
  // Brisis avant et arrière.
  k.quad([-x, 0, z], [x, 0, z], [x, hBrisis, zi], [-x, hBrisis, zi], n1, [[0, 0], [l, 0], [l, pente], [0, pente]]);
  k.quad([x, 0, -z], [-x, 0, -z], [-x, hBrisis, -zi], [x, hBrisis, -zi], [0, n1[1]!, -n1[2]!], [[0, 0], [l, 0], [l, pente], [0, pente]]);
  // Terrasson (deux pans faibles).
  const pt = Math.hypot(zi, hTerrasson);
  k.quad([-x, hBrisis, zi], [x, hBrisis, zi], [x, hBrisis + hTerrasson, 0], [-x, hBrisis + hTerrasson, 0], [0, zi / pt, hTerrasson / pt], [[0, 0], [l, 0], [l, pt], [0, pt]]);
  k.quad([x, hBrisis, -zi], [-x, hBrisis, -zi], [-x, hBrisis + hTerrasson, 0], [x, hBrisis + hTerrasson, 0], [0, zi / pt, -hTerrasson / pt], [[0, 0], [l, 0], [l, pt], [0, pt]]);
  // Pignons.
  for (const s of [-1, 1]) {
    const xx = s * x;
    const pts = [[xx, 0, -z], [xx, 0, z], [xx, hBrisis, zi], [xx, hBrisis + hTerrasson, 0], [xx, hBrisis, -zi]];
    const nn = [s, 0, 0];
    const uv = (q: number[]) => [q[2]! * s, q[1]!];
    const ordre = s > 0 ? [1, 0, 4, 2] : [0, 1, 2, 4];
    k.quad(pts[ordre[0]!]!, pts[ordre[1]!]!, pts[ordre[2]!]!, pts[ordre[3]!]!, nn, ordre.map((i) => uv(pts[i]!)));
    const t = s > 0 ? [2, 4, 3, 3] : [4, 2, 3, 3];
    k.quad(pts[t[0]!]!, pts[t[1]!]!, pts[t[2]!]!, pts[t[3]!]!, nn, t.map((i) => uv(pts[i]!)));
  }
  return k.maillage(device);
}

/** Crée une entité de rendu à partir d'un maillage et d'un matériau. */
export function entite(nom: string, maillage: pc.Mesh, materiau: pc.Material, ombre: boolean, groupe?: number): pc.Entity {
  const e = new pc.Entity(nom);
  e.addComponent('render', {
    meshInstances: [new pc.MeshInstance(maillage, materiau)],
    castShadows: ombre,
    receiveShadows: true,
    batchGroupId: groupe ?? null,
  });
  return e;
}

export interface Houppier {
  x: number;
  y: number;
  z: number;
  /** Demi-largeur horizontale et demi-hauteur de l'ellipsoïde de feuillage. */
  rayonH: number;
  rayonV: number;
  cartes: number;
  graine: number;
}

/**
 * Feuillage en « cartes » : quadrilatères texturés (rameau à transparence) répartis dans des ellipsoïdes.
 * Tous les houppiers sont fusionnés en un seul maillage (un appel de dessin).
 * Les normales pointent vers l'extérieur du houppier : éclairage volumique doux plutôt que plat.
 */
export function cartesFeuillage(device: pc.GraphicsDevice, houppiers: readonly Houppier[], taille = 1.7): pc.Mesh {
  const k = new Constructeur();
  for (const h of houppiers) {
    let a = h.graine >>> 0;
    const r = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < h.cartes; i++) {
      // Point dans l'ellipsoïde, plutôt vers la surface (houppier dense au bord, creux au centre).
      const th = r() * Math.PI * 2;
      const ph = Math.acos(1 - 2 * r() * 0.92);
      const rad = 0.55 + 0.45 * Math.cbrt(r());
      const nx = Math.sin(ph) * Math.cos(th);
      const ny = Math.cos(ph);
      const nz = Math.sin(ph) * Math.sin(th);
      const cx = h.x + nx * h.rayonH * rad;
      const cy = h.y + ny * h.rayonV * rad;
      const cz = h.z + nz * h.rayonH * rad;
      // Orientation : à peu près tangente au houppier, avec du désordre ; rameau tombant.
      const yaw = Math.atan2(nx, nz) + (r() - 0.5) * 1.6;
      const s = taille * (0.75 + r() * 0.5);
      const ux = Math.cos(yaw) * s / 2;
      const uz = -Math.sin(yaw) * s / 2;
      const incl = (r() - 0.3) * 0.9;
      const vy = Math.cos(incl) * s / 2;
      const vh = Math.sin(incl) * s / 2;
      const vx = Math.sin(yaw) * vh;
      const vz = Math.cos(yaw) * vh;
      const p = (sx: number, sy: number) => [cx + ux * sx + vx * sy, cy + vy * sy, cz + uz * sx + vz * sy];
      const nl = Math.hypot(nx, ny * 0.6 + 0.4, nz) || 1;
      const n = [nx / nl, (ny * 0.6 + 0.4) / nl, nz / nl];
      k.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  return k.maillage(device);
}
