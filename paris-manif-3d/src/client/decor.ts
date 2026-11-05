// Décor de la place : sols, façades haussmanniennes, monument, mobilier, végétation, ciel et lumière.
// Construit à partir de la carte (src/sim/carte.ts) avec des ressources réelles (Poly Haven, ambientCG ;
// voir docs/LICENCES.md) et, pour ce qui n'existe pas en libre (façades haussmanniennes, monument fictif),
// des textures procédurales enrichies de détails photographiques.

import * as pc from 'playcanvas';
import { ARBRES_X, hauteurCorniche, RANGEES_ARBRES_Z, type Carte, type Immeuble, type Obstacle } from '../sim/carte';
import { boite, cartesFeuillage, entite, mansarde, panneau, sol, type Houppier } from './geometrie';
import type { Ressources, TexturePBR } from './ressources';
import * as T from './textures';

export type Qualite = 'basse' | 'haute';

interface Contexte {
  app: pc.Application;
  device: pc.GraphicsDevice;
  haute: boolean;
  anis: number;
  groupe: number;
  racine: pc.Entity;
  m: Materiaux;
  res: Ressources;
  houppiers: Houppier[];
}

function couleur(hex: string): pc.Color {
  return new pc.Color().fromString(hex);
}

function simple(hex: string, gloss = 0.3, metal = 0): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  m.diffuse = couleur(hex);
  m.gloss = gloss;
  m.metalness = metal;
  m.update();
  return m;
}

/** Ajoute un enfant rendu (maillage partagé) et le place. */
function poser(ctx: Contexte, parent: pc.Entity, nom: string, maillage: pc.Mesh, materiau: pc.Material, pos: [number, number, number], ombre = ctx.haute, rotY = 0): pc.Entity {
  const e = entite(nom, maillage, materiau, ombre, ctx.groupe);
  e.setLocalPosition(...pos);
  if (rotY) e.setLocalEulerAngles(0, rotY, 0);
  parent.addChild(e);
  return e;
}

/** Primitive PlayCanvas (cylindre, sphère, cône, capsule) avec matériau. */
function primitive(ctx: Contexte, parent: pc.Entity, type: 'cylinder' | 'sphere' | 'cone' | 'capsule' | 'box', materiau: pc.Material, pos: [number, number, number], echelle: [number, number, number], ombre = ctx.haute, rot: [number, number, number] = [0, 0, 0]): pc.Entity {
  const e = new pc.Entity(type);
  e.addComponent('render', { type, material: materiau, castShadows: ombre, receiveShadows: true, batchGroupId: ctx.groupe });
  e.setLocalPosition(...pos);
  // La capsule PlayCanvas mesure 2 m de haut : on exprime toutes les longueurs en mètres.
  e.setLocalScale(echelle[0], type === 'capsule' ? echelle[1] / 2 : echelle[1], echelle[2]);
  e.setLocalEulerAngles(...rot);
  parent.addChild(e);
  return e;
}

// ——————————————————————————————————————————————— Matériaux

type Materiaux = ReturnType<typeof creerMateriaux>;

/**
 * Matériau PBR à partir d'un jeu Poly Haven (couleur, normales GL, ARM).
 * `metres` = taille réelle couverte par la texture (dimensions publiées par Poly Haven).
 */
function pbr(t: TexturePBR, metres: number, o: { teinte?: string; gloss?: number; normale?: number; detail?: TexturePBR; metresDetail?: number } = {}): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  const tiling = new pc.Vec2(1 / metres, 1 / metres);
  m.useMetalness = true;
  m.metalness = 0;
  m.diffuseMap = t.couleur;
  m.diffuseMapTiling = tiling;
  if (o.teinte) m.diffuse = couleur(o.teinte);
  m.normalMap = t.normale;
  m.normalMapTiling = tiling;
  m.bumpiness = o.normale ?? 1;
  m.aoMap = t.arm;
  m.aoMapChannel = 'r';
  m.aoMapTiling = tiling;
  m.glossMap = t.arm;
  m.glossMapChannel = 'g';
  m.glossInvert = true; // la carte contient une rugosité
  m.glossMapTiling = tiling;
  m.gloss = o.gloss ?? 1;
  m.update();
  return m;
}

function creerMateriaux(device: pc.GraphicsDevice, haute: boolean, anis: number, res: Ressources) {
  const M = (c: T.Couches, o: T.OptionsMateriau) => T.materiauCouches(device, c, o, anis);
  // Sols et écorce : textures photographiques Poly Haven à leur échelle réelle.
  const dalles = pbr(res.dalles, 1.825, { teinte: '#f2efe9' });
  const paves = pbr(res.paves, 2.175, { normale: 1.2 });
  const asphalte = pbr(res.asphalte, 3, { teinte: '#a9a9a9' });
  const ecorce = pbr(res.ecorce, 1.5, { normale: 1.3 });
  const pierre = pbr(res.pierre, 3, { teinte: '#e6dcc6', normale: 0.6 });
  const pierreClaire = pbr(res.pierre, 2, { teinte: '#f1e9d8', normale: 0.6 });

  // Façades haussmanniennes : aucune texture libre adaptée trouvée ; la travée procédurale (fenêtres,
  // moulures) reçoit le grain photographique de la pierre en carte de détail.
  const traveeCouches = T.travee(Math.round(256 * (haute ? 1.5 : 1)));
  const travees = [couleur('#ffffff'), couleur('#f3ece0'), couleur('#e9e6e0')].map((teinte) => {
    const m = M(traveeCouches, { metres: [3, 3.1], gloss: 0.3, normaleForce: 6, teinte });
    m.normalDetailMap = res.pierre.normale;
    m.normalDetailMapTiling = new pc.Vec2(3 / 1.5, 3.1 / 1.5); // relatif à la travée de 3 × 3,1 m
    m.normalDetailMapBumpiness = 0.8;
    m.update();
    return m;
  });
  const zinc = M(T.zinc(128), { metres: [2, 2], gloss: 0.5, metalness: 0.55, normaleForce: 3 });
  const bronze = M(T.bronze(128), { metres: [1.5, 1.5], gloss: 0.55, metalness: 0.75, normaleForce: 2 });

  // Feuillage de platane : cartes à transparence (LeafSet010 d'ambientCG, rameau composé).
  const feuilles = new pc.StandardMaterial();
  feuilles.useMetalness = true;
  feuilles.diffuseMap = res.rameau;
  feuilles.opacityMap = res.rameau;
  feuilles.opacityMapChannel = 'a';
  feuilles.alphaTest = 0.45;
  feuilles.alphaToCoverage = haute; // bords doux avec l'anticrénelage MSAA
  feuilles.cull = pc.CULLFACE_NONE;
  feuilles.twoSidedLighting = true;
  feuilles.gloss = 0.35;
  feuilles.diffuse = couleur('#a7b394'); // vert de platane en été, moins acide que la photo
  feuilles.update();

  const fer = gardeCorpsMateriau(device, anis);
  const m = {
    dalles, paves, asphalte, zinc, ecorce, feuilles, bronze, fer,
    travee0: travees[0]!, travee1: travees[1]!, travee2: travees[2]!,
    pierre,
    pierreClaire,
    corniche: simple('#d3c5a7', 0.2),
    fonte: simple('#222a26', 0.55, 0.6),
    galva: simple('#9ea3a6', 0.55, 0.85),
    grille: simple('#2a2c2c', 0.4, 0.7),
    marquage: simple('#e8e6df', 0.25),
    cheminee: simple('#b0715a', 0.15),
    vitre: simple('#56697a', 0.92, 0.1),
  };
  return m;
}

function gardeCorpsMateriau(device: pc.GraphicsDevice, anis: number): pc.StandardMaterial {
  const tex = T.texture(device, T.gardeCorps(256), true, anis);
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  m.diffuse = couleur('#ffffff');
  m.diffuseMap = tex;
  m.opacityMap = tex;
  m.opacityMapChannel = 'a';
  m.alphaTest = 0.4;
  m.metalness = 0.6;
  m.gloss = 0.45;
  m.cull = pc.CULLFACE_NONE;
  m.twoSidedLighting = true;
  m.diffuseMapTiling = new pc.Vec2(1 / 1.5, 1);
  m.opacityMapTiling = new pc.Vec2(1 / 1.5, 1);
  m.update();
  return m;
}

// ——————————————————————————————————————————————— Lumière, ciel, brouillard

export interface Ambiance {
  soleil: pc.Entity;
}

/**
 * Le soleil du HDRI (kloofendal_48d_partly_cloudy_puresky) est à 48° d'élévation et à l'azimut
 * équirectangulaire u = 0,5952, soit atan2(x, z) = 0,598 rad dans la convention de PlayCanvas.
 * On fait tourner le ciel pour placer le soleil derrière la caméra de départ (sud-ouest de la place),
 * puis on aligne la lumière directionnelle sur ce soleil : ombres et reflets cohérents avec le ciel.
 */
const SOLEIL_HDRI_AZIMUT = 0.598;
const SOLEIL_HDRI_ELEVATION = (48 * Math.PI) / 180;
const SOLEIL_AZIMUT_VOULU = -2.17; // vers −x et −z : façades est et sud éclairées
export function directionSoleil(): pc.Vec3 {
  const az = SOLEIL_AZIMUT_VOULU;
  return new pc.Vec3(Math.cos(SOLEIL_HDRI_ELEVATION) * Math.sin(az), Math.sin(SOLEIL_HDRI_ELEVATION), Math.cos(SOLEIL_HDRI_ELEVATION) * Math.cos(az));
}

function lumiere(ctx: Contexte): Ambiance {
  const { app, haute, res } = ctx;
  // Ciel et éclairage d'ambiance (IBL) depuis le HDRI.
  const ciel = pc.EnvLighting.generateSkyboxCubemap(res.ciel, haute ? 1024 : 512);
  const source = pc.EnvLighting.generateLightingSource(res.ciel, { size: haute ? 256 : 128 });
  app.scene.envAtlas = pc.EnvLighting.generateAtlas(source, { size: haute ? 512 : 256 });
  source.destroy();
  app.scene.skybox = ciel;
  app.scene.skyboxMip = 0;
  app.scene.skyboxIntensity = 1;
  app.scene.ambientLight = new pc.Color(0, 0, 0);
  // Mesuré par balayage du ciel rendu : azimut rendu = −(azimut HDRI + rotation) (l'axe x est inversé
  // par la projection du ciel). D'où la rotation qui amène le soleil du HDRI à l'azimut voulu.
  const rotation = new pc.Quat().setFromEulerAngles(0, ((-SOLEIL_AZIMUT_VOULU - SOLEIL_HDRI_AZIMUT) * 180) / Math.PI, 0);
  app.scene.skyboxRotation = rotation;

  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = new pc.Color(0.74, 0.8, 0.86);
  app.scene.fog.start = haute ? 80 : 60;
  app.scene.fog.end = haute ? 380 : 260;

  const soleil = new pc.Entity('soleil');
  soleil.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.95, 0.86),
    intensity: 2.4,
    castShadows: true,
    shadowType: haute ? pc.SHADOW_PCF3_32F : pc.SHADOW_PCF1_32F,
    shadowResolution: haute ? 2048 : 1024,
    numCascades: haute ? 3 : 1,
    cascadeDistribution: 0.6,
    shadowDistance: haute ? 90 : 30,
    shadowBias: 0.25,
    normalOffsetBias: 0.06,
  });
  // Une lumière directionnelle éclaire selon son −Y : on oriente son +Y vers le soleil.
  const versSoleil = directionSoleil();
  const axe = new pc.Vec3().cross(pc.Vec3.UP, versSoleil).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, pc.Vec3.UP.dot(versSoleil)))) * (180 / Math.PI);
  soleil.setRotation(new pc.Quat().setFromAxisAngle(axe, angle));
  app.root.addChild(soleil);
  return { soleil };
}

// ——————————————————————————————————————————————— Sols

function sols(ctx: Contexte, carte: Carte): void {
  const { device, racine, m } = ctx;
  const l = carte.limites;
  const marge = 2;
  // Chaussée.
  racine.addChild(entite('chaussee', sol(device, -130, -90, 130, 90, 0), m.asphalte, false, ctx.groupe));
  // Esplanade piétonne surélevée de 14 cm (dalles) + bordure en pavés de granit.
  const y = 0.14;
  racine.addChild(entite('esplanade', sol(device, l.minX - marge, l.minZ - marge, l.maxX + marge, l.maxZ + marge, y), m.dalles, false, ctx.groupe));
  const lx = l.maxX - l.minX + 2 * marge;
  const lz = l.maxZ - l.minZ + 2 * marge;
  const bord = 0.32;
  for (const [x, z, a, b] of [
    [0, l.minZ - marge, lx + bord * 2, bord], [0, l.maxZ + marge, lx + bord * 2, bord],
    [l.minX - marge, 0, bord, lz], [l.maxX + marge, 0, bord, lz],
  ] as const) poser(ctx, racine, 'bordure', boite(device, a, y + 0.02, b), m.paves, [x, 0, z], false);
  // Bandes de stabilisé sous les arbres (pavés), et grilles d'arbres.
  for (const z of [-RANGEES_ARBRES_Z, RANGEES_ARBRES_Z]) {
    racine.addChild(entite('bande', sol(device, -37, z - 1.6, 37, z + 1.6, y + 0.005), m.paves, false, ctx.groupe));
    for (const x of ARBRES_X) poser(ctx, racine, 'grille', boite(device, 1.5, 0.02, 1.5), m.grille, [x, y, z], false);
  }
  // Trottoirs au pied des façades et passages piétons devant les rues.
  for (const im of carte.immeubles) {
    const versX = im.orientation === 'est' || im.orientation === 'ouest';
    const s = im.orientation === 'sud' || im.orientation === 'est' ? 1 : -1; // vers la place
    const largeur = 3.5;
    const cx = versX ? im.x + s * largeur / 2 : im.x;
    const cz = versX ? im.z : im.z + s * largeur / 2;
    const a = versX ? largeur : im.longueur + 7;
    const b = versX ? im.longueur + 7 : largeur;
    poser(ctx, racine, 'trottoir', boite(device, a, y, b), m.paves, [cx, 0, cz], false);
  }
  // Passages piétons (bandes blanches de 0,5 m) entre l'esplanade et les trottoirs.
  for (const x of [-30, 0, 30]) {
    for (const z0 of [-29.6, 26.2]) {
      for (let i = 0; i < 6; i++) poser(ctx, racine, 'zebra', boite(device, 3, 0.012, 0.5), m.marquage, [x, 0, z0 + i * 0.75 + 0.25], false);
    }
  }
}

// ——————————————————————————————————————————————— Immeubles

function immeuble(ctx: Contexte, im: Immeuble): void {
  const { device, m, haute } = ctx;
  const racine = new pc.Entity(im.id);
  const angle = { sud: 0, nord: 180, est: 90, ouest: -90 }[im.orientation];
  racine.setPosition(im.x, 0, im.z);
  racine.setEulerAngles(0, angle, 0);
  ctx.racine.addChild(racine);

  const L = im.longueur;
  const P = im.profondeur;
  const hC = hauteurCorniche(im);
  const travee = [m.travee0, m.travee1, m.travee2][im.graine % 3]!;

  // Corps de bâtiment (pierre) derrière la façade.
  poser(ctx, racine, 'corps', boite(device, L, hC, P), m.pierre, [0, 0, -P / 2]);
  // Rez-de-chaussée commercial et étages courants.
  const rdc = T.materiauCouches(device, T.rezDeChaussee(L, im.graine * 17, haute ? 48 : 28), { metres: [L, 4.6], gloss: 0.3, normaleForce: 3 }, ctx.anis);
  poser(ctx, racine, 'rdc', panneau(device, L, 4.6), rdc, [-L / 2, 0, 0.03]);
  poser(ctx, racine, 'etages', panneau(device, L, im.etages * 3.1), travee, [-L / 2, 4.6, 0.03]);

  // Entablement du rez-de-chaussée et corniche principale (débords).
  poser(ctx, racine, 'entablement', boite(device, L, 0.35, 0.35), m.corniche, [0, 4.45, 0.15]);
  poser(ctx, racine, 'corniche', boite(device, L + 0.3, 0.45, 0.75), m.corniche, [0, hC - 0.3, 0.2]);
  // Balcons filants : étage noble (2e) et 5e, dalle + garde-corps en fer forgé.
  for (const etage of [1, 4]) {
    const yB = 4.6 + etage * 3.1 - 0.12;
    poser(ctx, racine, 'balcon', boite(device, L - 0.2, 0.16, 0.8), m.corniche, [0, yB, 0.4]);
    poser(ctx, racine, 'gardecorps', panneau(device, L - 0.2, 1.0), m.fer, [-(L - 0.2) / 2, yB + 0.16, 0.79], haute);
  }
  // Balconnets devant chaque porte-fenêtre des autres étages (haute qualité seulement).
  if (haute) {
    const garde = panneau(device, 1.35, 0.85);
    for (const etage of [2, 3]) {
      for (let k = 0; k < L / 3; k++) {
        const x = -L / 2 + k * 3 + 1.5;
        poser(ctx, racine, 'balconnet', garde, m.fer, [x - 0.675, 4.6 + etage * 3.1 + 0.02, 0.22], false);
        poser(ctx, racine, 'appui', boite(device, 1.45, 0.08, 0.25), m.corniche, [x, 4.6 + etage * 3.1, 0.13], false);
      }
    }
  }
  // Toit à la Mansart en zinc, lucarnes et souches de cheminée.
  poser(ctx, racine, 'toit', mansarde(device, L, P), m.zinc, [0, hC, -P / 2]);
  if (haute) {
    for (let k = 0; k < L / 3; k++) {
      const x = -L / 2 + k * 3 + 1.5;
      poser(ctx, racine, 'lucarne', boite(device, 1.1, 1.5, 0.9), m.corniche, [x, hC + 0.7, -0.75], false);
      poser(ctx, racine, 'lucarneVitre', panneau(device, 0.7, 1.0), m.vitre, [x - 0.35, hC + 0.85, -0.29], false);
      poser(ctx, racine, 'lucarneToit', boite(device, 1.25, 0.18, 1.05), m.zinc, [x, hC + 2.2, -0.75], false);
    }
  }
  const r = T.alea(im.graine * 31);
  for (let i = 0; i < Math.max(2, Math.round(L / 7)); i++) {
    const x = -L / 2 + 2 + r() * (L - 4);
    poser(ctx, racine, 'cheminee', boite(device, 0.9, 1.6, 2.2), m.cheminee, [x, hC + 3.4, -P / 2 + (r() - 0.5) * 2]);
  }
  // Plaque de rue (nom fictif) sur certains angles.
  if (im.graine % 3 === 0) plaqueRue(ctx, racine, L / 2 - 0.8, 3.6, ['RUE DES TANNEURS', 'BD DES ARCADES', 'RUE DU LAVOIR', 'RUE DES MOULINS'][im.graine % 4]!);
}

function plaqueRue(ctx: Contexte, parent: pc.Entity, x: number, y: number, nom: string): void {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f4f8f';
  g.beginPath();
  g.roundRect(0, 0, 256, 96, 10);
  g.fill();
  g.strokeStyle = '#e9eef5';
  g.lineWidth = 5;
  g.strokeRect(10, 10, 236, 76);
  g.fillStyle = '#ffffff';
  g.font = 'bold 24px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(nom, 128, 50, 220);
  const m = new pc.StandardMaterial();
  m.diffuseMap = T.texture(ctx.device, c, true, ctx.anis, false);
  m.gloss = 0.7;
  m.update();
  poser(ctx, parent, 'plaque', panneau(ctx.device, 0.9, 0.34), m, [x - 0.45, y, 0.06], false);
}

// ——————————————————————————————————————————————— Monument

function monument(ctx: Contexte): void {
  const { device, m, racine } = ctx;
  const mon = new pc.Entity('monument');
  racine.addChild(mon);
  // Emmarchement (3 marches) sur l'esplanade.
  [9, 8.1, 7.2].forEach((c, i) => poser(ctx, mon, `marche${i}`, boite(device, c, 0.14 + 0.32 * (i + 1), c), m.pierreClaire, [0, 0, 0]));
  // Piédestal à corniches, avec quatre bas-reliefs en creux suggérés par des panneaux de bronze.
  poser(ctx, mon, 'base', boite(device, 5.2, 0.7, 5.2), m.corniche, [0, 1.1, 0]);
  poser(ctx, mon, 'plinthe', boite(device, 4.6, 0.25, 4.6), m.pierreClaire, [0, 1.8, 0]);
  poser(ctx, mon, 'piedestal', boite(device, 4.0, 3.4, 4.0), m.pierreClaire, [0, 2.05, 0]);
  poser(ctx, mon, 'corniche', boite(device, 4.6, 0.35, 4.6), m.corniche, [0, 5.45, 0]);
  poser(ctx, mon, 'attique', boite(device, 3.0, 1.2, 3.0), m.pierreClaire, [0, 5.8, 0]);
  poser(ctx, mon, 'couronnement', boite(device, 3.4, 0.25, 3.4), m.corniche, [0, 7.0, 0]);
  for (const r of [0, 90, 180, 270]) {
    const p = new pc.Entity('faceRelief');
    p.setLocalEulerAngles(0, r, 0);
    mon.addChild(p);
    poser(ctx, p, 'cadre', boite(device, 2.4, 2.1, 0.08), m.corniche, [0, 2.65, 2.0], false);
    poser(ctx, p, 'relief', panneau(device, 2.1, 1.8), m.bronze, [-1.05, 2.8, 2.05], false);
  }
  // Statue allégorique (gothic_statue, Poly Haven) : figure drapée et couronnée, livre et chaînes.
  // 1,74 m à l'origine, mise à l'échelle d'un monument (≈ 3,8 m) sur le couronnement.
  const statue = copieModele(ctx.res.statue, 'allegorie');
  statue.setLocalPosition(-0.9, 7.25, 0.1); // le maillage n'est pas centré sur son origine
  statue.setLocalScale(2.2, 2.2, 2.2);
  statue.setLocalEulerAngles(0, -90, 0); // regarde vers l'ouest, d'où l'on arrive
  for (const r of statue.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    r.receiveShadows = true;
  }
  mon.addChild(statue);
}

// ——————————————————————————————————————————————— Mobilier et végétation

function arbre(ctx: Contexte, x: number, z: number): void {
  const { m, racine } = ctx;
  const r = T.alea(Math.round(x * 13 + z * 7 + 1000));
  const a = new pc.Entity('platane');
  a.setLocalPosition(x, 0.14, z);
  a.setLocalEulerAngles(0, r() * 360, 0);
  racine.addChild(a);
  // Fût légèrement conique (écorce de platane Poly Haven), puis charpentières obliques.
  primitive(ctx, a, 'cone', m.ecorce, [0, 2.5, 0], [0.6, 5.0, 0.6], true);
  const nb = ctx.haute ? 4 : 3;
  for (let i = 0; i < nb; i++) {
    const ang = (i * 360) / nb + r() * 30;
    const b = new pc.Entity('branche');
    b.setLocalPosition(0, 4.3, 0);
    b.setLocalEulerAngles(0, ang, 0);
    a.addChild(b);
    primitive(ctx, b, 'capsule', m.ecorce, [0.7, 1.1, 0], [0.2, 2.6, 0.2], ctx.haute, [0, 0, -38 - r() * 10]);
  }
  // Houppier en parasol : deux ellipsoïdes de cartes (bas large, haut plus étroit).
  const rot = r() * 1000;
  ctx.houppiers.push({ x, y: 6.6 + r() * 0.4, z, rayonH: 3.4, rayonV: 1.9, cartes: ctx.haute ? 130 : 55, graine: Math.round(rot) });
  ctx.houppiers.push({ x: x + (r() - 0.5), y: 8.0, z: z + (r() - 0.5), rayonH: 2.2, rayonV: 1.3, cartes: ctx.haute ? 50 : 22, graine: Math.round(rot) + 1 });
}

/**
 * Copie d'un modèle GLB placée sous une entité pivot. Le pivot est indispensable : si le fichier n'a
 * qu'un nœud racine, instantiateRenderEntity renvoie ce nœud, et le déplacer effacerait sa propre
 * transformation (cas de la statue, dont le nœud est décalé de +1,19 m).
 */
export function copieModele(conteneur: pc.ContainerResource, nom: string): pc.Entity {
  const pivot = new pc.Entity(nom);
  pivot.addChild(conteneur.instantiateRenderEntity());
  return pivot;
}

/** Instancie un modèle GLB (ressource partagée) et regroupe ses rendus pour le batching. */
function instancier(ctx: Contexte, conteneur: pc.ContainerResource, nom: string, x: number, z: number, rotY: number): pc.Entity {
  const e = copieModele(conteneur, nom);
  e.setLocalPosition(x, 0.14, z);
  e.setLocalEulerAngles(0, rotY, 0);
  for (const r of e.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    r.receiveShadows = true;
    r.batchGroupId = ctx.groupe;
  }
  ctx.racine.addChild(e);
  return e;
}

function lampadaire(ctx: Contexte, x: number, z: number): void {
  // Candélabre de style XIXe (street_lamp_01, Poly Haven), 3,87 m.
  instancier(ctx, ctx.res.lampadaire, 'lampadaire', x, z, (x * 37 + z * 11) % 360);
}

function banc(ctx: Contexte, o: Obstacle): void {
  // Banc lattes de bois et piètement métallique (module droit de modular_street_seating, Poly Haven).
  // Dans le modèle, le dossier est côté −z : on le tourne vers l'extérieur de la place.
  const cz = (o.minZ + o.maxZ) / 2;
  instancier(ctx, ctx.res.banc, 'banc', (o.minX + o.maxX) / 2, cz, cz < 0 ? 0 : 180);
}

function colonne(ctx: Contexte, o: Obstacle): void {
  const { m, racine, device } = ctx;
  const c = new pc.Entity('colonne');
  c.setLocalPosition((o.minX + o.maxX) / 2, 0.14, (o.minZ + o.maxZ) / 2);
  racine.addChild(c);
  const tex = document.createElement('canvas');
  tex.width = 384;
  tex.height = 192;
  const g = tex.getContext('2d')!;
  for (let i = 0; i < 3; i++) g.drawImage(T.affiche(i + 5), i * 128, 0);
  const mat = new pc.StandardMaterial();
  mat.diffuseMap = T.texture(device, tex, true, ctx.anis);
  mat.gloss = 0.25;
  mat.update();
  primitive(ctx, c, 'cylinder', m.fonte, [0, 0.25, 0], [1.4, 0.5, 1.4]);
  primitive(ctx, c, 'cylinder', mat, [0, 1.65, 0], [1.2, 2.3, 1.2]);
  primitive(ctx, c, 'cylinder', m.fonte, [0, 2.9, 0], [1.4, 0.2, 1.4]);
  primitive(ctx, c, 'cone', m.fonte, [0, 3.35, 0], [1.3, 0.7, 1.3]);
  primitive(ctx, c, 'sphere', m.fonte, [0, 3.75, 0], [0.2, 0.2, 0.2], false);
}

function barrieres(ctx: Contexte, o: Obstacle): void {
  const { m, racine, device } = ctx;
  const lx = o.maxX - o.minX;
  const lz = o.maxZ - o.minZ;
  const longueur = Math.max(lx, lz);
  const rot = lx >= lz ? 0 : 90;
  const n = Math.round(longueur / 2);
  const groupe = new pc.Entity('barrieres');
  groupe.setLocalPosition((o.minX + o.maxX) / 2, 0.14, (o.minZ + o.maxZ) / 2);
  groupe.setLocalEulerAngles(0, rot, 0);
  racine.addChild(groupe);
  for (let i = 0; i < n; i++) {
    const x0 = -longueur / 2 + i * 2 + 0.05;
    const s = new pc.Entity('section');
    s.setLocalPosition(x0, 0, 0);
    s.setLocalEulerAngles(0, (i % 2 ? 1 : -1) * 2, 0);
    groupe.addChild(s);
    for (const y of [0.12, 1.08]) poser(ctx, s, 'rail', boite(device, 1.9, 0.04, 0.04), m.galva, [0.95, y, 0]);
    for (const x of [0, 1.9]) poser(ctx, s, 'montant', boite(device, 0.045, 1.1, 0.045), m.galva, [x, 0.04, 0]);
    for (let k = 1; k < 12; k++) poser(ctx, s, 'barreau', boite(device, 0.018, 0.96, 0.018), m.galva, [k * (1.9 / 12), 0.12, 0], false);
    for (const x of [0.1, 1.8]) poser(ctx, s, 'pied', boite(device, 0.06, 0.04, 0.6), m.galva, [x, 0, 0], false);
  }
}

// ——————————————————————————————————————————————— Construction

export function construireDecor(app: pc.Application, carte: Carte, qualite: Qualite, res: Ressources): Ambiance {
  const haute = qualite === 'haute';
  const device = app.graphicsDevice;
  const anis = Math.min(haute ? 8 : 2, device.maxAnisotropy);
  // Regroupement des objets statiques : moins d'appels de dessin, surtout sur mobile.
  const groupe = app.batcher!.addGroup('decor', false, 40).id;
  const racine = new pc.Entity('decor');
  app.root.addChild(racine);
  const ctx: Contexte = { app, device, haute, anis, groupe, racine, m: creerMateriaux(device, haute, anis, res), res, houppiers: [] };

  const ambiance = lumiere(ctx);
  sols(ctx, carte);
  for (const im of carte.immeubles) immeuble(ctx, im);
  monument(ctx);
  for (const o of carte.obstacles) {
    if (o.genre === 'arbre') arbre(ctx, (o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2);
    else if (o.genre === 'lampadaire') lampadaire(ctx, (o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2);
    else if (o.genre === 'banc') banc(ctx, o);
    else if (o.genre === 'colonne') colonne(ctx, o);
    else if (o.genre === 'barriere') barrieres(ctx, o);
  }
  // Tous les houppiers en un seul maillage.
  const feuillage = entite('feuillage', cartesFeuillage(device, ctx.houppiers, haute ? 1.6 : 2.1), ctx.m.feuilles, true);
  racine.addChild(feuillage);
  return ambiance;
}
