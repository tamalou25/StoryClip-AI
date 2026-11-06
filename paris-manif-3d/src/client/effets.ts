// Repères visuels de la partie (indépendants du décor) : anneaux de zone au sol, marqueurs sous les
// acteurs, nuages de gaz fictif, éclats de slogan. Lecture seule de l'état de la simulation.

import * as pc from 'playcanvas';
import type { Monde } from '../sim/monde';
import type { Camp } from '../sim/regles';
import { GAZ_RAYON } from '../sim/regles';

export const COULEUR_CAMP: Record<Camp, pc.Color> = {
  manif: new pc.Color(0.95, 0.62, 0.2),
  ordre: new pc.Color(0.3, 0.55, 0.98),
};
const NEUTRE = new pc.Color(0.9, 0.9, 0.88);
/** Hauteur de l'esplanade (dalles) : les repères au sol se posent juste au-dessus. */
const SOL = 0.14;

function materiauPlat(couleur: pc.Color, opacite: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.emissive = couleur;
  m.diffuse = new pc.Color(0, 0, 0);
  m.opacity = opacite;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/** Anneau plat (maillage) : rayon intérieur et extérieur, posé au sol. */
function maillageAnneau(device: pc.GraphicsDevice, rInt: number, rExt: number, segments = 48): pc.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * rInt, 0, s * rInt, c * rExt, 0, s * rExt);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const normales: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) normales.push(0, 1, 0);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normales);
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

class AnneauZone {
  readonly entite: pc.Entity;
  private readonly mat: pc.StandardMaterial;
  private readonly remplissage: pc.Entity;
  private readonly matRemplissage: pc.StandardMaterial;
  private pulsation = 0;

  constructor(app: pc.Application, x: number, z: number, rayon: number) {
    this.mat = materiauPlat(NEUTRE, 0.75);
    this.entite = new pc.Entity('zone');
    this.entite.addComponent('render', { meshInstances: [new pc.MeshInstance(maillageAnneau(app.graphicsDevice, rayon - 0.35, rayon), this.mat)], castShadows: false, receiveShadows: false });
    this.entite.setPosition(x, SOL + 0.03, z);
    app.root.addChild(this.entite);
    // Disque intérieur discret, teinté par le contrôle.
    this.matRemplissage = materiauPlat(NEUTRE, 0);
    this.remplissage = new pc.Entity('zone-fond');
    this.remplissage.addComponent('render', { meshInstances: [new pc.MeshInstance(maillageAnneau(app.graphicsDevice, 0, rayon - 0.35, 40), this.matRemplissage)], castShadows: false, receiveShadows: false });
    this.remplissage.setPosition(x, SOL + 0.02, z);
    app.root.addChild(this.remplissage);
  }

  maj(controle: number, tenue: Camp | null, contestee: boolean, dt: number): void {
    this.pulsation += dt * (contestee ? 5 : 1.5);
    const c = controle > 0 ? COULEUR_CAMP.manif : controle < 0 ? COULEUR_CAMP.ordre : NEUTRE;
    const k = Math.abs(controle);
    this.mat.emissive.set(NEUTRE.r + (c.r - NEUTRE.r) * k, NEUTRE.g + (c.g - NEUTRE.g) * k, NEUTRE.b + (c.b - NEUTRE.b) * k);
    this.mat.opacity = (tenue ? 0.85 : 0.6) + (contestee ? Math.sin(this.pulsation) * 0.15 : 0);
    this.mat.update();
    this.matRemplissage.emissive.copy(this.mat.emissive);
    this.matRemplissage.opacity = 0.05 + k * 0.1;
    this.matRemplissage.update();
  }
}

/** Nuage de gaz fictif (aussi utilisé par le mode multijoueur, à partir de l'état réseau). */
export class Nuage3D {
  readonly entite: pc.Entity;
  private readonly mats: pc.StandardMaterial[] = [];
  constructor(app: pc.Application, x: number, z: number, graine: number) {
    this.entite = new pc.Entity('nuage');
    this.entite.setPosition(x, SOL, z);
    app.root.addChild(this.entite);
    // Quelques sphères irrégulières : lisible sans flash ni clignotement.
    let s = graine;
    const alea = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 7; i++) {
      const m = materiauPlat(new pc.Color(0.86, 0.88, 0.8), 0.28);
      this.mats.push(m);
      const e = new pc.Entity('boule');
      e.addComponent('render', { type: 'sphere', material: m, castShadows: false, receiveShadows: false });
      const a = alea() * Math.PI * 2;
      const r = alea() * GAZ_RAYON * 0.55;
      const taille = GAZ_RAYON * (0.9 + alea() * 0.6);
      e.setLocalPosition(Math.cos(a) * r, 0.6 + alea() * 1.2, Math.sin(a) * r);
      e.setLocalScale(taille, taille * 0.7, taille);
      this.entite.addChild(e);
    }
  }
  maj(reste: number, duree: number, opaciteMax: number): void {
    const t = 1 - reste / duree;
    const fondu = Math.min(1, t * 6) * Math.min(1, reste / 2.5);
    for (const m of this.mats) { m.opacity = opaciteMax * fondu; m.update(); }
  }
  detruire(): void { this.entite.destroy(); }
}

class Eclat {
  readonly entite: pc.Entity;
  private readonly mat: pc.StandardMaterial;
  reste = 0.9;
  constructor(app: pc.Application, x: number, z: number, couleur: pc.Color) {
    this.mat = materiauPlat(couleur, 0.8);
    this.entite = new pc.Entity('eclat');
    this.entite.addComponent('render', { meshInstances: [new pc.MeshInstance(maillageAnneau(app.graphicsDevice, 0.3, 0.6, 32), this.mat)], castShadows: false, receiveShadows: false });
    this.entite.setPosition(x, SOL + 0.05, z);
    app.root.addChild(this.entite);
  }
  maj(dt: number): boolean {
    this.reste -= dt;
    const t = 1 - Math.max(0, this.reste) / 0.9;
    const s = 1 + t * 9;
    this.entite.setLocalScale(s, 1, s);
    this.mat.opacity = 0.8 * (1 - t);
    this.mat.update();
    if (this.reste <= 0) { this.entite.destroy(); return false; }
    return true;
  }
}

export class Effets {
  private readonly zones = new Map<string, AnneauZone>();
  private readonly nuages = new Map<string, Nuage3D>();
  private readonly marqueurs = new Map<string, { entite: pc.Entity; mat: pc.StandardMaterial }>();
  private eclats: Eclat[] = [];
  /** Opacité maximale du gaz (option « réduire les effets »). */
  opaciteGaz = 0.28;

  constructor(private readonly app: pc.Application) {}

  /** Appelé à chaque nouvelle partie : les anneaux sont recréés selon les zones du monde. */
  reinitialiser(monde: Monde): void {
    for (const z of this.zones.values()) { z.entite.destroy(); }
    this.zones.clear();
    for (const z of monde.zones) this.zones.set(z.id, new AnneauZone(this.app, z.x, z.z, z.rayon));
    for (const n of this.nuages.values()) n.detruire();
    this.nuages.clear();
    for (const e of this.eclats) e.entite.destroy();
    this.eclats = [];
    for (const id of [...this.marqueurs.keys()]) if (!monde.acteurs[id]) { this.marqueurs.get(id)!.entite.destroy(); this.marqueurs.delete(id); }
    for (const id of monde.ordre) if (!this.marqueurs.has(id)) this.creerMarqueur(id, monde.acteurs[id]!.camp);
  }

  private creerMarqueur(id: string, camp: Camp): void {
    const mat = materiauPlat(COULEUR_CAMP[camp], 0.7);
    const entite = new pc.Entity('marqueur');
    entite.addComponent('render', { meshInstances: [new pc.MeshInstance(maillageAnneau(this.app.graphicsDevice, 0.38, 0.5, 28), mat)], castShadows: false, receiveShadows: false });
    this.app.root.addChild(entite);
    this.marqueurs.set(id, { entite, mat });
  }

  /** Position interpolée d'un acteur (fournie par la boucle) ; souffle ∈ [0, 1]. */
  majMarqueur(id: string, x: number, z: number, visible: boolean, souffle: number, estJoueur: boolean): void {
    const m = this.marqueurs.get(id);
    if (!m) return;
    m.entite.enabled = visible;
    if (!visible) return;
    m.entite.setPosition(x, SOL + 0.04, z);
    const s = estJoueur ? 1.25 : 1;
    m.entite.setLocalScale(s, 1, s);
    m.mat.opacity = 0.35 + 0.5 * souffle;
    m.mat.update();
  }

  maj(monde: Monde, dt: number): void {
    for (const z of monde.zones) {
      const contestee = z.presents.manif > 0 && z.presents.ordre > 0;
      this.zones.get(z.id)?.maj(z.controle, z.tenue, contestee, dt);
    }
    const vus = new Set<string>();
    for (const n of monde.nuages) {
      vus.add(n.id);
      let n3 = this.nuages.get(n.id);
      if (!n3) { n3 = new Nuage3D(this.app, n.x, n.z, n.id.length * 7919 + monde.tick); this.nuages.set(n.id, n3); }
      n3.maj(n.reste, n.duree, this.opaciteGaz);
    }
    for (const [id, n3] of this.nuages) if (!vus.has(id)) { n3.detruire(); this.nuages.delete(id); }
    this.eclats = this.eclats.filter((e) => e.maj(dt));
  }

  eclat(x: number, z: number, camp: Camp): void {
    this.eclats.push(new Eclat(this.app, x, z, COULEUR_CAMP[camp]));
  }
}
