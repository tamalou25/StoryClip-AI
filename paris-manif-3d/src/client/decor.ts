// Décor de la place : sols, façades haussmanniennes, monument, mobilier, végétation, ciel et lumière.
// Construit à partir de la carte (src/sim/carte.ts) avec des ressources réelles (Poly Haven, ambientCG ;
// voir docs/LICENCES.md) et, pour ce qui n'existe pas en libre (façades haussmanniennes, monument fictif),
// des textures procédurales enrichies de détails photographiques.

import * as pc from 'playcanvas';
import { ARBRES_X, hauteurCorniche, RANGEES_ARBRES_Z, type Carte, type Immeuble, type Obstacle } from '../sim/carte';
import { boite, entite, mansarde, panneau, sol } from './geometrie';
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
  kit?: Map<string, pc.Entity>;
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
  // Pierre de taille : grain photographique (Poly Haven) + joints d'assise générés (carte de détail).
  const pierre = pbr(res.pierre, 3, { teinte: '#efe8dc', normale: 0.6 });
  const joints = T.jointsPierre(haute ? 512 : 256);
  pierre.diffuseDetailMap = T.texture(device, joints.couleur, true, anis);
  // Le pavage de détail s'applique aux UV d'origine (en mètres) : toile de 2 m → 1/2.
  pierre.diffuseDetailMapTiling = new pc.Vec2(1 / 2, 1 / 2);
  pierre.normalDetailMap = T.texture(device, T.normales(joints.hauteur, joints.largeur, joints.hauteurPx, 2.5), false, anis);
  pierre.normalDetailMapTiling = pierre.diffuseDetailMapTiling;
  pierre.update();
  const pierreClaire = pbr(res.pierre, 2, { teinte: '#f4efe6', normale: 0.6 });

  // Devantures fictives : atlas de 8 boutiques, une matière par cellule (même texture partagée).
  const atlas = T.devantures(haute ? 1 : 0.5);
  const atlasCouleur = T.texture(device, atlas.couleur, true, anis, false);
  const atlasBrillance = T.texture(device, atlas.brillance, false, anis, false);
  const devantures = Array.from({ length: 8 }, (_, i) => {
    const d = new pc.StandardMaterial();
    d.name = `devanture_${i}`;
    d.useMetalness = true;
    d.metalness = 0;
    d.diffuseMap = atlasCouleur;
    d.glossMap = atlasBrillance;
    d.glossMapChannel = 'g';
    d.gloss = 0.9;
    for (const carte of ['diffuseMap', 'glossMap'] as const) {
      d[`${carte}Tiling`] = new pc.Vec2(0.25, 0.5);
      d[`${carte}Offset`] = new pc.Vec2((i % 4) * 0.25, Math.floor(i / 4) * 0.5);
    }
    d.update();
    return d;
  });
  const portes = ['#21362c', '#4a1c22', '#1d2a3a', '#1c1c1c'].map((hex) => simple(hex, 0.5));
  // Toiles des stores bannes (4 variantes dans une même texture).
  const toiles = T.texture(device, T.toilesStores(), true, anis, false);
  const stores = [0, 1, 2, 3].map((i) => {
    const t = new pc.StandardMaterial();
    t.useMetalness = true;
    t.metalness = 0; // défaut PlayCanvas = 1 (métal) : à préciser pour toute matière non métallique
    t.diffuseMap = toiles;
    t.diffuseMapTiling = new pc.Vec2(1, 0.25);
    t.diffuseMapOffset = new pc.Vec2(0, i * 0.25);
    t.gloss = 0.18;
    t.update();
    return t;
  });
  const zinc = M(T.zinc(128), { metres: [2, 2], gloss: 0.5, metalness: 0.55, normaleForce: 3 });
  const bronze = M(T.bronze(128), { metres: [1.5, 1.5], gloss: 0.55, metalness: 0.75, normaleForce: 2 });

  // Feuillage de platane : cartes à transparence (LeafSet010 d'ambientCG, rameau composé).
  const feuilles = new pc.StandardMaterial();
  feuilles.useMetalness = true;
  feuilles.metalness = 0; // défaut PlayCanvas = 1 : les feuilles étaient rendues comme du métal
  feuilles.diffuseMap = res.rameau;
  feuilles.opacityMap = res.rameau;
  feuilles.opacityMapChannel = 'a';
  feuilles.alphaTest = 0.45;
  feuilles.alphaToCoverage = haute; // bords doux avec l'anticrénelage MSAA
  feuilles.cull = pc.CULLFACE_NONE;
  // Les normales des cartes suivent l'ellipsoïde du houppier (Blender) : pas d'éclairage bifacial,
  // sinon les faces arrière, nombreuses au bord du houppier, reçoivent une normale inversée et noircissent.
  feuilles.twoSidedLighting = false;
  feuilles.gloss = 0.18; // feuilles mates : un reflet d'environnement trop fort les blanchit
  feuilles.diffuse = couleur('#98a28a'); // vert de platane en été, moins acide que la photo
  // Translucidité simulée : un peu de lumière « traverse » les feuilles (émission modulée par la texture),
  // sinon l'intérieur du houppier, à l'ombre de lui-même, vire au noir.
  feuilles.emissive = new pc.Color(0.16, 0.19, 0.11);
  feuilles.emissiveMap = res.rameau;
  feuilles.emissiveIntensity = haute ? 0.55 : 0.4;
  feuilles.update();

  const fer = gardeCorpsMateriau(device, anis);
  const m = {
    dalles, paves, asphalte, zinc, ecorce, feuilles, bronze, fer,
    pierre,
    pierreClaire,
    devantures,
    portes,
    stores,
    corniche: pierreClaire,
    granit: pbr(res.pierre, 2, { teinte: '#9c9c99', normale: 0.8 }),
    menuiserie: simple('#e8e4da', 0.45),
    vitre: simple('#1b2329', 0.94, 0.35),
    fonte: simple('#222a26', 0.55, 0.6),
    galva: simple('#9ea3a6', 0.55, 0.85),
    grille: simple('#2a2c2c', 0.4, 0.7),
    marquage: simple('#e8e6df', 0.25),
    cheminee: simple('#b0715a', 0.15),
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
  // UV du kit Blender exprimés en motifs (1 motif de garde-corps = 1,5 m).
  m.diffuseMapTiling = new pc.Vec2(1, 1);
  m.opacityMapTiling = new pc.Vec2(1, 1);
  m.update();
  return m;
}

// ——————————————————————————————————————————————— Lumière, ciel, brouillard

export interface Ambiance {
  soleil: pc.Entity;
}

/**
 * Le soleil du HDRI (kloofendal_38d_partly_cloudy_puresky, fin d'après-midi) est à 37,8° d'élévation et
 * à l'azimut équirectangulaire u = 0,6001, soit atan2(x, z) = 0,629 rad dans la convention de PlayCanvas.
 * On fait tourner le ciel pour placer le soleil derrière la caméra de départ (sud-ouest de la place),
 * puis on aligne la lumière directionnelle sur ce soleil : ombres et reflets cohérents avec le ciel.
 */
const SOLEIL_HDRI_AZIMUT = 0.629;
const SOLEIL_HDRI_ELEVATION = (37.8 * Math.PI) / 180;
const SOLEIL_AZIMUT_VOULU = -2.17; // vers −x et −z : façades est et sud éclairées
export function directionSoleil(): pc.Vec3 {
  const az = SOLEIL_AZIMUT_VOULU;
  return new pc.Vec3(Math.cos(SOLEIL_HDRI_ELEVATION) * Math.sin(az), Math.sin(SOLEIL_HDRI_ELEVATION), Math.cos(SOLEIL_HDRI_ELEVATION) * Math.cos(az));
}

function lumiere(ctx: Contexte): Ambiance {
  const { app, haute, res } = ctx;
  // Ciel et éclairage d'ambiance (IBL) depuis le HDRI.
  // Faces du cube dimensionnées sur la source (HDRI 2k ≈ 512 px par quart de tour) : au-delà, mémoire perdue.
  const ciel = pc.EnvLighting.generateSkyboxCubemap(res.ciel, haute ? 512 : 256);
  const source = pc.EnvLighting.generateLightingSource(res.ciel, { size: haute ? 256 : 128 });
  app.scene.envAtlas = pc.EnvLighting.generateAtlas(source, { size: haute ? 512 : 256 });
  source.destroy();
  res.ciel.destroy(); // l'équirectangulaire source n'est plus utile (2 Mo en basse, 8 Mo en haute)
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
    color: new pc.Color(1, 0.93, 0.82), // soleil de fin d'après-midi (teinte mesurée dans le HDRI, accentuée)
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
  // Composition du dallage : bandes de pavés de granit qui découpent de grands panneaux (repères pour
  // le joueur, moins de monotonie), et cadre pavé autour du monument.
  const bandes: [number, number, number, number][] = [];
  for (const x of [-33, -22, -11, 11, 22, 33]) bandes.push([x - 0.3, l.minZ - marge, x + 0.3, -RANGEES_ARBRES_Z - 1.6]);
  for (const x of [-33, -22, -11, 11, 22, 33]) bandes.push([x - 0.3, RANGEES_ARBRES_Z + 1.6, x + 0.3, l.maxZ + marge]);
  for (const x of [-33, -22, -11, 11, 22, 33]) bandes.push([x - 0.3, -RANGEES_ARBRES_Z + 1.6, x + 0.3, RANGEES_ARBRES_Z - 1.6]);
  for (const [cote, larg] of [[7.2, 0.8]] as const) {
    bandes.push([-cote, -cote, cote, -cote + larg], [-cote, cote - larg, cote, cote], [-cote, -cote + larg, -cote + larg, cote - larg], [cote - larg, -cote + larg, cote, cote - larg]);
  }
  for (const [x0, z0, x1, z1] of bandes) racine.addChild(entite('bande-paves', sol(device, x0, z0, x1, z1, y + 0.004), m.paves, false, ctx.groupe));

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

/** Pièces du kit de façade (gabarits non affichés), indexées par nom de nœud. */
function gabaritsFacade(ctx: Contexte): Map<string, pc.Entity> {
  const kit = ctx.res.facade.instantiateRenderEntity();
  const pieces = new Map<string, pc.Entity>();
  for (const nom of ['rdc_boutique', 'rdc_porte', 'etage_simple', 'etage_balcon', 'etage_balconnet', 'corniche', 'lucarne', 'store']) {
    const e = kit.findByName(nom) as pc.Entity | null;
    if (!e) throw new Error(`Pièce absente du kit de façade : ${nom}`);
    pieces.set(nom, e);
  }
  return pieces;
}

/** Pose une copie de pièce du kit et remplace ses matériaux par ceux du jeu (par nom). */
function poserPiece(ctx: Contexte, parent: pc.Entity, nom: string, x: number, y: number, z: number, remplacements: Record<string, pc.Material>): void {
  const e = ctx.kit!.get(nom)!.clone() as pc.Entity;
  e.setLocalPosition(x, y, z);
  for (const r of e.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    r.receiveShadows = true;
    r.batchGroupId = ctx.groupe;
    for (const mi of r.meshInstances) {
      const m = mi.material ? remplacements[mi.material.name] : undefined;
      if (m) mi.material = m;
    }
  }
  parent.addChild(e);
}

const NIVEAU_TROTTOIR = 0.14;
const ETAGES_TYPES = ['etage_simple', 'etage_balcon', 'etage_balconnet', 'etage_balconnet', 'etage_balcon'];

function immeuble(ctx: Contexte, im: Immeuble): void {
  const { device, m, haute } = ctx;
  const racine = new pc.Entity(im.id);
  const angle = { sud: 0, nord: 180, est: 90, ouest: -90 }[im.orientation];
  racine.setPosition(im.x, NIVEAU_TROTTOIR, im.z); // la façade part du niveau du trottoir
  racine.setEulerAngles(0, angle, 0);
  ctx.racine.addChild(racine);

  const L = im.longueur;
  const P = im.profondeur;
  const hC = hauteurCorniche(im);
  const hToit = hC + 0.8; // dessus du chéneau de la corniche
  const RETRAIT = 0.42; // le corps recule derrière la façade : les baies gardent leur profondeur

  // Corps de bâtiment (pierre) et retours de mur aux extrémités de la façade.
  poser(ctx, racine, 'corps', boite(device, L, hToit + NIVEAU_TROTTOIR, P - RETRAIT), m.pierre, [0, -NIVEAU_TROTTOIR, -RETRAIT - (P - RETRAIT) / 2]);
  for (const s of [-1, 1]) poser(ctx, racine, 'retour', boite(device, 0.3, hC, RETRAIT), m.pierre, [s * (L / 2 - 0.15), 0, -RETRAIT / 2]);

  // Façade : travées de 3 m du kit Blender (rez-de-chaussée, 5 étages, corniche, lucarnes).
  const remplacements: Record<string, pc.Material> = {
    pierre: m.pierre, corniche: m.corniche, menuiserie: m.menuiserie, vitre: m.vitre,
    ferronnerie: m.fer, fonte: m.fonte, zinc: m.zinc, porte: m.portes[im.graine % m.portes.length]!,
  };
  const travees = Math.round(L / 3);
  const porte = (im.graine * 5) % travees;
  for (let k = 0; k < travees; k++) {
    const x = -L / 2 + 1.5 + k * 3;
    // Une boutique par travée (enseignes variées) ; une travée porte cochère par immeuble.
    const boutique = m.devantures[(im.graine * 3 + k) % m.devantures.length]!;
    poserPiece(ctx, racine, k === porte ? 'rdc_porte' : 'rdc_boutique', x, 0, 0, { ...remplacements, devanture: boutique });
    // Stores bannes sur environ une boutique sur deux (cafés, brasseries, fleuristes…).
    if (k !== porte && (im.graine + k) % 2 === 0) poserPiece(ctx, racine, 'store', x, 0, 0, { ...remplacements, toile: m.stores[(im.graine + k) % m.stores.length]! });
    for (let e = 0; e < im.etages; e++) poserPiece(ctx, racine, ETAGES_TYPES[e % ETAGES_TYPES.length]!, x, 4.6 + e * 3.1, 0, remplacements);
    poserPiece(ctx, racine, 'corniche', x, hC + 0.5, 0, remplacements);
    if (k % (haute ? 2 : 3) === 0) poserPiece(ctx, racine, 'lucarne', x, hToit + 0.9, -0.28, remplacements);
  }

  // Toit à la Mansart en zinc et souches de cheminée.
  poser(ctx, racine, 'toit', mansarde(device, L, P), m.zinc, [0, hToit, -P / 2]);
  const r = T.alea(im.graine * 31);
  for (let i = 0; i < Math.max(2, Math.round(L / 7)); i++) {
    const x = -L / 2 + 2 + r() * (L - 4);
    poser(ctx, racine, 'cheminee', boite(device, 0.9, 1.6, 2.2), m.cheminee, [x, hToit + 3.4, -P / 2 + (r() - 0.5) * 2]);
  }
  // Plaque de rue (nom fictif) sur le retour du bâtiment, côté rue.
  if (im.graine % 3 === 0) plaqueRue(ctx, racine, L / 2 + 0.01, 4.2, ['RUE DES TANNEURS', 'BD DES ARCADES', 'RUE DU LAVOIR', 'RUE DES MOULINS'][im.graine % 4]!);
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
  const p = poser(ctx, parent, 'plaque', panneau(ctx.device, 0.9, 0.34), m, [x, y, -1.4], false);
  p.setLocalEulerAngles(0, 90, 0);
}

// ——————————————————————————————————————————————— Monument

function monument(ctx: Contexte): void {
  // Piédestal modélisé dans Blender (blender/scripts/monument.py) : emmarchement en granit, socle mouluré,
  // dé à plaques de bronze encadrées, corniche, attique. Couronnement à 7,13 m.
  const mon = copieModele(ctx.res.monument, 'monument');
  mon.setLocalPosition(0, 0.14, 0);
  const remplacements: Record<string, pc.Material> = { granit: ctx.m.granit, pierre_claire: ctx.m.pierreClaire, bronze: ctx.m.bronze };
  for (const r of mon.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    r.receiveShadows = true;
    for (const mi of r.meshInstances) {
      const m = mi.material ? remplacements[mi.material.name] : undefined;
      if (m) mi.material = m;
    }
  }
  ctx.racine.addChild(mon);
  // Statue allégorique (gothic_statue, Poly Haven) : figure drapée et couronnée, livre et chaînes.
  // 1,74 m à l'origine, mise à l'échelle d'un monument (≈ 3,8 m) sur le couronnement.
  const statue = copieModele(ctx.res.statue, 'allegorie');
  statue.setLocalPosition(-0.9, 7.13 + 0.14, 0.1); // le maillage n'est pas centré sur son origine
  statue.setLocalScale(2.2, 2.2, 2.2);
  statue.setLocalEulerAngles(0, -90, 0); // regarde vers l'ouest, d'où l'on arrive
  // La statue Poly Haven est en pierre moussue ; on l'assombrit vers un bronze patiné, plus courant
  // sur les monuments parisiens et plus lisible contre le ciel.
  const patine = new Map<pc.Material, pc.StandardMaterial>();
  for (const r of statue.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = true;
    r.receiveShadows = true;
    for (const mi of r.meshInstances) {
      const origine = mi.material as pc.StandardMaterial;
      let copie = patine.get(origine);
      if (!copie) {
        copie = origine.clone();
        copie.diffuse = new pc.Color().fromString('#5d5444');
        copie.metalness = 0.55;
        copie.gloss = Math.max(copie.gloss, 0.5);
        copie.update();
        patine.set(origine, copie);
      }
      mi.material = copie;
    }
  }
  ctx.racine.addChild(statue);
}

// ——————————————————————————————————————————————— Mobilier et végétation

function arbre(ctx: Contexte, x: number, z: number): void {
  // Platane commun généré dans Blender (blender/scripts/platane.py) : 3 variantes, rotation aléatoire.
  const r = T.alea(Math.round(x * 13 + z * 7 + 1000));
  const variante = ctx.res.platanes[Math.floor(r() * ctx.res.platanes.length)]!;
  const e = instancier(ctx, variante, 'platane', x, z, r() * 360);
  for (const rc of e.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of rc.meshInstances) {
      if (mi.material?.name === 'ecorce') mi.material = ctx.m.ecorce;
      else if (mi.material?.name === 'feuillage') mi.material = ctx.m.feuilles;
    }
  }
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
  // Cellules de 200 m : toute la place tient dans une cellule, un lot par matériau (limité à 65 535 sommets).
  const groupe = app.batcher!.addGroup('decor', false, 200).id;
  const racine = new pc.Entity('decor');
  app.root.addChild(racine);
  const ctx: Contexte = { app, device, haute, anis, groupe, racine, m: creerMateriaux(device, haute, anis, res), res };

  const ambiance = lumiere(ctx);
  sols(ctx, carte);
  ctx.kit = gabaritsFacade(ctx);
  for (const im of carte.immeubles) immeuble(ctx, im);
  monument(ctx);
  for (const o of carte.obstacles) {
    if (o.genre === 'arbre') arbre(ctx, (o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2);
    else if (o.genre === 'lampadaire') lampadaire(ctx, (o.minX + o.maxX) / 2, (o.minZ + o.maxZ) / 2);
    else if (o.genre === 'banc') banc(ctx, o);
    else if (o.genre === 'colonne') colonne(ctx, o);
    else if (o.genre === 'barriere') barrieres(ctx, o);
  }
  return ambiance;
}
