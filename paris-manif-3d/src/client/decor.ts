// Décor de la place : sols, façades haussmanniennes, monument, mobilier, végétation, ciel et lumière.
// Tout est construit en code à partir de la carte (src/sim/carte.ts) et de textures procédurales.

import * as pc from 'playcanvas';
import { ARBRES_X, centreCorps, hauteurCorniche, RANGEES_ARBRES_Z, type Carte, type Immeuble, type Obstacle } from '../sim/carte';
import { boite, entite, mansarde, panneau, sol } from './geometrie';
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
  hasard: () => number;
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

function creerMateriaux(device: pc.GraphicsDevice, haute: boolean, anis: number) {
  const t = haute ? 1 : 0.5;
  const M = (c: T.Couches, o: T.OptionsMateriau) => T.materiauCouches(device, c, o, anis);
  const dalles = M(T.dalles(haute ? 1024 : 384), { metres: [4.8, 4.8], gloss: 0.32, normaleForce: 2.5 });
  const paves = M(T.paves(Math.round(256 * t)), { metres: [1.4, 1.4], gloss: 0.3, normaleForce: 4 });
  const asphalte = M(T.asphalte(Math.round(256 * t)), { metres: [6, 6], gloss: 0.18, normaleForce: 1.5 });
  const traveeCouches = T.travee(Math.round(256 * (haute ? 1.5 : 1)));
  const travees = [couleur('#ffffff'), couleur('#f3ece0'), couleur('#e9e6e0')].map((teinte) =>
    M(traveeCouches, { metres: [3, 3.1], gloss: 0.3, normaleForce: 6, teinte }),
  );
  const zinc = M(T.zinc(128), { metres: [2, 2], gloss: 0.5, metalness: 0.55, normaleForce: 3 });
  const ecorce = M(T.ecorce(128), { metres: [1.2, 1.2], gloss: 0.15, normaleForce: 5 });
  const couchesFeuilles = T.feuillage(Math.round(256 * t));
  const feuilles = M(couchesFeuilles, { metres: [1.6, 1.6], gloss: 0.18, normaleForce: 2, teinte: couleur('#c9d3b4') });
  const feuillesClaires = M(couchesFeuilles, { metres: [1.6, 1.6], gloss: 0.2, normaleForce: 2, teinte: couleur('#eef0cf') });
  const bronze = M(T.bronze(128), { metres: [1.5, 1.5], gloss: 0.55, metalness: 0.75, normaleForce: 2 });

  const fer = gardeCorpsMateriau(device, anis);
  const m = {
    dalles, paves, asphalte, zinc, ecorce, feuilles, feuillesClaires, bronze, fer,
    travee0: travees[0]!, travee1: travees[1]!, travee2: travees[2]!,
    pierre: simple('#d8ccb1', 0.22),
    pierreClaire: simple('#e2d8c2', 0.25),
    corniche: simple('#d3c5a7', 0.2),
    fonte: simple('#222a26', 0.55, 0.6),
    bois: simple('#7a5a3c', 0.3),
    galva: simple('#9ea3a6', 0.55, 0.85),
    lanterne: simple('#e8e4d6', 0.9),
    grille: simple('#2a2c2c', 0.4, 0.7),
    marquage: simple('#e8e6df', 0.25),
    plaque: simple('#204a87', 0.6),
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
  ciel: pc.Entity;
}

function lumiere(ctx: Contexte): Ambiance {
  const { app, haute } = ctx;
  app.scene.ambientLight = new pc.Color(0.3, 0.33, 0.39);
  app.scene.fog.type = pc.FOG_LINEAR;
  app.scene.fog.color = new pc.Color(0.8, 0.84, 0.87);
  app.scene.fog.start = haute ? 70 : 50;
  app.scene.fog.end = haute ? 320 : 220;

  const soleil = new pc.Entity('soleil');
  soleil.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.93, 0.82),
    intensity: 1.45,
    castShadows: true,
    shadowType: haute ? pc.SHADOW_PCF3_32F : pc.SHADOW_PCF1_32F,
    shadowResolution: haute ? 2048 : 1024,
    numCascades: haute ? 3 : 1,
    cascadeDistribution: 0.6,
    shadowDistance: haute ? 90 : 28,
    shadowBias: 0.25,
    normalOffsetBias: 0.06,
  });
  // Soleil de fin d'après-midi : rasant, venant du sud-ouest → longues ombres lisibles.
  soleil.setEulerAngles(38, 215, 0);
  app.root.addChild(soleil);

  // Lumière de rebond du ciel (sans ombre) pour déboucher les faces à l'ombre.
  const ciel = new pc.Entity('rebond');
  ciel.addComponent('light', { type: 'directional', color: new pc.Color(0.62, 0.72, 0.9), intensity: 0.45, castShadows: false });
  ciel.setEulerAngles(-60, 40, 0);
  app.root.addChild(ciel);

  // Dôme de ciel peint, suit la caméra.
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveMap = T.texture(ctx.device, T.ciel(), true, 1, true);
  m.diffuse = new pc.Color(0, 0, 0);
  m.cull = pc.CULLFACE_FRONT;
  m.depthWrite = false;
  m.update();
  const dome = new pc.Entity('ciel');
  dome.addComponent('render', { type: 'sphere', material: m, castShadows: false, receiveShadows: false });
  dome.setLocalScale(800, 800, 800);
  app.root.addChild(dome);
  return { soleil, ciel: dome };
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
  void centreCorps;
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
  // Quatre figures assises (silhouettes simplifiées en bronze) aux angles du socle.
  for (const [x, z] of [[2.9, 2.9], [-2.9, 2.9], [2.9, -2.9], [-2.9, -2.9]] as const) {
    const f = new pc.Entity('figure');
    f.setLocalPosition(x, 1.1, z);
    f.setLocalEulerAngles(0, (Math.atan2(x, z) * 180) / Math.PI, 0);
    mon.addChild(f);
    primitive(ctx, f, 'box', m.pierreClaire, [0, 0.4, 0], [1.2, 0.8, 1.2]);
    primitive(ctx, f, 'capsule', m.bronze, [0, 1.25, -0.1], [0.55, 0.9, 0.5], ctx.haute, [-10, 0, 0]);
    primitive(ctx, f, 'sphere', m.bronze, [0, 1.95, 0], [0.38, 0.42, 0.38]);
    primitive(ctx, f, 'capsule', m.bronze, [0, 0.95, 0.35], [0.5, 0.6, 0.45], ctx.haute, [80, 0, 0]);
  }
  // Allégorie fictive au sommet : drapé (cône), buste, tête, bras levé tenant un rameau.
  const s = new pc.Entity('allegorie');
  s.setLocalPosition(0, 7.25, 0);
  s.setLocalScale(1.25, 1.25, 1.25);
  s.setLocalEulerAngles(0, 90, 0);
  mon.addChild(s);
  primitive(ctx, s, 'cylinder', m.bronze, [0, 0.15, 0], [1.4, 0.3, 1.4]);
  primitive(ctx, s, 'cone', m.bronze, [0, 1.85, 0], [1.5, 3.4, 1.3]);
  primitive(ctx, s, 'capsule', m.bronze, [0, 3.85, 0], [0.75, 1.4, 0.55]);
  primitive(ctx, s, 'sphere', m.bronze, [0, 4.75, 0], [0.48, 0.56, 0.5]);
  primitive(ctx, s, 'cone', m.bronze, [0, 5.0, -0.05], [0.62, 0.5, 0.62]); // coiffe
  primitive(ctx, s, 'capsule', m.bronze, [0.45, 5.0, 0], [0.22, 1.5, 0.22], ctx.haute, [0, 0, -12]); // bras levé
  primitive(ctx, s, 'capsule', m.bronze, [0.62, 6.0, 0], [0.12, 0.9, 0.3], ctx.haute, [0, 0, 20]); // rameau
  primitive(ctx, s, 'capsule', m.bronze, [-0.5, 3.6, 0.15], [0.2, 1.2, 0.2], ctx.haute, [20, 0, 15]);
}

// ——————————————————————————————————————————————— Mobilier et végétation

function arbre(ctx: Contexte, x: number, z: number): void {
  const { m, racine } = ctx;
  const r = T.alea(Math.round(x * 13 + z * 7 + 1000));
  const a = new pc.Entity('platane');
  a.setLocalPosition(x, 0.14, z);
  a.setLocalEulerAngles(0, r() * 360, 0);
  racine.addChild(a);
  primitive(ctx, a, 'cone', m.ecorce, [0, 2.3, 0], [0.62, 4.6, 0.62], true);
  // Charpentières : trois grosses branches obliques.
  for (let i = 0; i < 3; i++) {
    const ang = i * 120 + r() * 40;
    const b = new pc.Entity('branche');
    b.setLocalPosition(0, 4.2, 0);
    b.setLocalEulerAngles(0, ang, 0);
    a.addChild(b);
    primitive(ctx, b, 'capsule', m.ecorce, [0.55, 0.9, 0], [0.2, 2.2, 0.2], ctx.haute, [0, 0, -32]);
  }
  // Houppier : amas de volumes de feuillage, plus nombreux en qualité haute.
  const n = ctx.haute ? 14 : 6;
  for (let i = 0; i < n; i++) {
    // Répartition sur un ellipsoïde aplati (port en parasol du platane taillé).
    const t = r() * Math.PI * 2;
    const d = i < 2 ? r() * 0.6 : 1.2 + r() * 1.6;
    const s = (ctx.haute ? 1.7 : 2.4) + r() * 1.1;
    const y = 6.3 + (1 - d / 2.8) * 1.6 + (r() - 0.5) * 0.8;
    const mat = r() < 0.35 ? m.feuillesClaires : m.feuilles;
    primitive(ctx, a, 'sphere', mat, [Math.cos(t) * d * 1.15, y, Math.sin(t) * d], [s * 1.2, s * 0.8, s * 1.1], true, [r() * 30, r() * 360, 0]);
  }
}

function lampadaire(ctx: Contexte, x: number, z: number): void {
  const { m, racine } = ctx;
  const l = new pc.Entity('lampadaire');
  l.setLocalPosition(x, 0.14, z);
  racine.addChild(l);
  primitive(ctx, l, 'cylinder', m.fonte, [0, 0.35, 0], [0.36, 0.7, 0.36]);
  primitive(ctx, l, 'cylinder', m.fonte, [0, 0.78, 0], [0.24, 0.16, 0.24]);
  primitive(ctx, l, 'cylinder', m.fonte, [0, 2.4, 0], [0.12, 3.2, 0.12]);
  primitive(ctx, l, 'cylinder', m.fonte, [0, 4.02, 0], [0.22, 0.08, 0.22]);
  primitive(ctx, l, 'cone', m.lanterne, [0, 4.3, 0], [0.42, 0.55, 0.42], ctx.haute, [180, 0, 0]);
  primitive(ctx, l, 'cone', m.fonte, [0, 4.7, 0], [0.55, 0.28, 0.55]);
  primitive(ctx, l, 'sphere', m.fonte, [0, 4.88, 0], [0.12, 0.12, 0.12], false);
}

function banc(ctx: Contexte, o: Obstacle): void {
  const { m, racine, device } = ctx;
  const b = new pc.Entity('banc');
  const cx = (o.minX + o.maxX) / 2;
  const cz = (o.minZ + o.maxZ) / 2;
  b.setLocalPosition(cx, 0.14, cz);
  b.setLocalEulerAngles(0, cz < 0 ? 0 : 180, 0); // dossier côté extérieur, assise vers le centre
  racine.addChild(b);
  for (let i = 0; i < 4; i++) poser(ctx, b, 'latte', boite(device, 1.9, 0.04, 0.09), m.bois, [0, 0.44, -0.18 + i * 0.12]);
  for (let i = 0; i < 3; i++) {
    const latte = poser(ctx, b, 'dossier', boite(device, 1.9, 0.09, 0.04), m.bois, [0, 0.55 + i * 0.13, -0.27]);
    latte.setLocalEulerAngles(-12, 0, 0);
  }
  for (const x of [-0.8, 0.8]) {
    poser(ctx, b, 'pied', boite(device, 0.06, 0.44, 0.5), m.fonte, [x, 0, -0.02]);
    poser(ctx, b, 'montant', boite(device, 0.06, 0.48, 0.05), m.fonte, [x, 0.44, -0.27]);
  }
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

export function construireDecor(app: pc.Application, carte: Carte, qualite: Qualite): Ambiance {
  const haute = qualite === 'haute';
  const device = app.graphicsDevice;
  const anis = Math.min(haute ? 8 : 2, device.maxAnisotropy);
  // Regroupement des objets statiques : moins d'appels de dessin, surtout sur mobile.
  const groupe = app.batcher!.addGroup('decor', false, 40).id;
  const racine = new pc.Entity('decor');
  app.root.addChild(racine);
  const ctx: Contexte = { app, device, haute, anis, groupe, racine, m: creerMateriaux(device, haute, anis), hasard: T.alea(1) };

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
  return ambiance;
}
