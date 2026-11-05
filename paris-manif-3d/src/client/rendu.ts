// Rendu PlayCanvas : décor en volumes simples et personnage « en blocs ».
// Lit les données de la carte ; n'écrit jamais dans la simulation.

import * as pc from 'playcanvas';
import type { Carte, GenreObstacle } from '../sim/carte';

export type Qualite = 'basse' | 'haute';

const COULEURS: Record<GenreObstacle | 'sol' | 'chaussee' | 'herbe', string> = {
  sol: '#c9c2b4',
  chaussee: '#5b5f66',
  herbe: '#7fa36b',
  socle: '#b8ad98',
  statue: '#6f8f86',
  arbre: '#6b4f3a',
  banc: '#3f6b4f',
  kiosque: '#2f5d50',
  immeuble: '#e4d8bf',
  barriere: '#999999',
};

const cacheMateriaux = new Map<string, pc.StandardMaterial>();
function materiau(hex: string): pc.StandardMaterial {
  let m = cacheMateriaux.get(hex);
  if (!m) {
    m = new pc.StandardMaterial();
    m.diffuse = new pc.Color().fromString(hex);
    m.gloss = 0.2;
    m.update();
    cacheMateriaux.set(hex, m);
  }
  return m;
}

type Forme = 'box' | 'cylinder' | 'sphere' | 'plane';
function bloc(parent: pc.Entity, nom: string, type: Forme, hex: string, pos: [number, number, number], echelle: [number, number, number], ombre: boolean): pc.Entity {
  const e = new pc.Entity(nom);
  e.addComponent('render', { type, material: materiau(hex), castShadows: ombre, receiveShadows: ombre });
  e.setLocalPosition(...pos);
  e.setLocalScale(...echelle);
  parent.addChild(e);
  return e;
}

export function creerApplication(canvas: HTMLCanvasElement, qualite: Qualite): pc.Application {
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: qualite === 'haute', powerPreference: 'high-performance' },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio = qualite === 'haute' ? Math.min(window.devicePixelRatio, 2) : 1;
  window.addEventListener('resize', () => app.resizeCanvas());
  return app;
}

export function construireDecor(app: pc.Application, carte: Carte, qualite: Qualite): void {
  const ombres = qualite === 'haute';
  app.scene.ambientLight = new pc.Color(0.55, 0.57, 0.62);

  const soleil = new pc.Entity('soleil');
  soleil.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.96, 0.88),
    intensity: 1.1,
    castShadows: ombres,
    shadowDistance: 45,
    shadowResolution: 1024,
    shadowBias: 0.3,
    normalOffsetBias: 0.05,
  });
  soleil.setEulerAngles(50, 35, 0);
  app.root.addChild(soleil);

  const decor = new pc.Entity('decor');
  app.root.addChild(decor);

  // Sol : chaussée tout autour, place piétonne au centre, deux bandes d'herbe sous les arbres.
  bloc(decor, 'chaussee', 'plane', COULEURS.chaussee, [0, -0.01, 0], [140, 1, 90], false).render!.receiveShadows = ombres;
  const l = carte.limites;
  bloc(decor, 'place', 'box', COULEURS.sol, [0, 0.05, 0], [l.maxX - l.minX, 0.1, l.maxZ - l.minZ], false).render!.receiveShadows = ombres;
  for (const z of [-17, 17]) bloc(decor, `herbe${z}`, 'box', COULEURS.herbe, [0, 0.11, z], [74, 0.02, 3], false);

  // Bordure basse qui matérialise les limites jouables.
  const h = 0.5;
  bloc(decor, 'bord-n', 'box', COULEURS.barriere, [0, h / 2, l.minZ], [l.maxX - l.minX, h, 0.2], ombres);
  bloc(decor, 'bord-s', 'box', COULEURS.barriere, [0, h / 2, l.maxZ], [l.maxX - l.minX, h, 0.2], ombres);
  bloc(decor, 'bord-o', 'box', COULEURS.barriere, [l.minX, h / 2, 0], [0.2, h, l.maxZ - l.minZ], ombres);
  bloc(decor, 'bord-e', 'box', COULEURS.barriere, [l.maxX, h / 2, 0], [0.2, h, l.maxZ - l.minZ], ombres);

  for (const o of carte.obstacles) {
    const lx = o.maxX - o.minX;
    const lz = o.maxZ - o.minZ;
    const cx = (o.minX + o.maxX) / 2;
    const cz = (o.minZ + o.maxZ) / 2;
    const type: Forme = o.genre === 'arbre' || o.genre === 'statue' ? 'cylinder' : 'box';
    bloc(decor, o.id, type, COULEURS[o.genre], [cx, o.hauteur / 2, cz], [lx, o.hauteur, lz], ombres);
    if (o.genre === 'arbre') {
      bloc(decor, `${o.id}-feuilles`, 'sphere', '#4f7d45', [cx, o.hauteur + 0.6, cz], [3.4, 2.8, 3.4], ombres);
    }
    if (o.genre === 'immeuble') {
      // Toit en zinc et bandeau de fenêtres stylisé.
      bloc(decor, `${o.id}-toit`, 'box', '#7d8794', [cx, o.hauteur + 0.6, cz], [lx * 0.96, 1.2, lz * 0.9], false);
      bloc(decor, `${o.id}-rdc`, 'box', '#8a6a4a', [cx, 1.6, cz], [lx * 1.01, 3.2, lz * 1.01], false);
    }
  }
}

/** Personnage stylisé en blocs, avec une animation de marche simple. */
export class ModelePersonnage {
  readonly racine: pc.Entity;
  private readonly corps: pc.Entity;
  private readonly jambeG: pc.Entity;
  private readonly jambeD: pc.Entity;
  private readonly brasG: pc.Entity;
  private readonly brasD: pc.Entity;
  private phase = 0;

  constructor(app: pc.Application, couleur: string, ombre: boolean) {
    this.racine = new pc.Entity('personnage');
    app.root.addChild(this.racine);
    this.corps = new pc.Entity('corps');
    this.racine.addChild(this.corps);

    const pivot = (nom: string, x: number, y: number) => {
      const p = new pc.Entity(nom);
      p.setLocalPosition(x, y, 0);
      this.corps.addChild(p);
      return p;
    };
    this.jambeG = pivot('jambeG', -0.2, 0.9);
    this.jambeD = pivot('jambeD', 0.2, 0.9);
    this.brasG = pivot('brasG', -0.55, 1.75);
    this.brasD = pivot('brasD', 0.55, 1.75);
    bloc(this.jambeG, 'j', 'box', '#2e3a59', [0, -0.45, 0], [0.36, 0.9, 0.4], ombre);
    bloc(this.jambeD, 'j', 'box', '#2e3a59', [0, -0.45, 0], [0.36, 0.9, 0.4], ombre);
    bloc(this.brasG, 'b', 'box', couleur, [0, -0.4, 0], [0.3, 0.8, 0.32], ombre);
    bloc(this.brasD, 'b', 'box', couleur, [0, -0.4, 0], [0.3, 0.8, 0.32], ombre);
    bloc(this.corps, 'torse', 'box', couleur, [0, 1.4, 0], [0.8, 0.95, 0.45], ombre);
    bloc(this.corps, 'tete', 'box', '#f0c9a0', [0, 2.15, 0], [0.5, 0.5, 0.5], ombre);
    // Visière vers l'avant (−z) pour lire l'orientation.
    bloc(this.corps, 'casquette', 'box', '#222831', [0, 2.42, -0.12], [0.54, 0.12, 0.7], false);
  }

  /** Place le modèle et anime la marche selon la vitesse (m/s). */
  majPose(x: number, z: number, cap: number, vitesse: number, action: boolean, dt: number): void {
    this.racine.setPosition(x, 0.1, z);
    this.racine.setEulerAngles(0, (cap * 180) / Math.PI, 0);
    const intensite = Math.min(vitesse / 5.5, 1);
    this.phase += dt * (4 + 6 * intensite);
    const angle = Math.sin(this.phase) * 35 * intensite;
    this.jambeG.setLocalEulerAngles(angle, 0, 0);
    this.jambeD.setLocalEulerAngles(-angle, 0, 0);
    this.brasG.setLocalEulerAngles(-angle, 0, 0);
    // Action (test) : bras droit levé.
    this.brasD.setLocalEulerAngles(action ? 170 : angle, 0, 0);
    this.corps.setLocalPosition(0, Math.abs(Math.sin(this.phase)) * 0.06 * intensite, 0);
  }
}
