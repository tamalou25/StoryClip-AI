// Prépare les ressources pour le jeu à partir de assets-sources/ (voir telecharger.mjs).
// Sorties dans public/ressources/ (versionnées) : textures WebP en deux qualités, modèles GLB optimisés,
// carte de feuillage composée, HDRI.
// Usage : node scripts/assets/preparer.mjs

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const SRC = join(RACINE, 'assets-sources');
const OUT = join(RACINE, 'public', 'ressources');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const taille = async (f) => `${((await stat(f)).size / 1024).toFixed(0)} ko`;
async function ecrire(f, buf) {
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, buf);
  console.log('  →', f.replace(RACINE + '/', ''), await taille(f));
}

// ——————————————————————————————— Textures PBR (Poly Haven)
// arm = AO (R), rugosité (G), métal (B).
const TEXTURES = [
  // 1024 px suffisent pour un motif de 1,8 m (≈ 560 px/m) ; 2048 coûtait 64 Mo de mémoire GPU.
  { id: 'concrete_tiles_02', haute: 1024, basse: 512 },
  { id: 'cobblestone_floor_09', haute: 1024, basse: 512 },
  { id: 'asphalt_02', haute: 1024, basse: 512 },
  { id: 'bark_platanus', haute: 1024, basse: 256 },
  { id: 'beige_wall_001', haute: 1024, basse: 512 },
];
const SANS_TEXTURES = process.argv.includes('--sans-textures');
for (const t of SANS_TEXTURES ? [] : TEXTURES) {
  console.log('Texture', t.id);
  for (const q of ['haute', 'basse']) {
    const px = t[q];
    for (const [entree, sortie, qualite] of [['Diffuse', 'couleur', 82], ['nor_gl', 'normale', 90], ['arm', 'arm', 85]]) {
      const buf = await sharp(join(SRC, 'polyhaven', t.id, `${entree}.jpg`)).resize(px, px).webp({ quality: qualite }).toBuffer();
      await ecrire(join(OUT, 'textures', t.id, q, `${sortie}.webp`), buf);
    }
  }
}

// ——————————————————————————————— Carte de feuillage (ambientCG LeafSet010)
// L'atlas contient 4 feuilles palmées (2 × 2). On compose un rameau : tige fine + ~22 feuilles
// tournées, mises à l'échelle et légèrement teintées. Le résultat (RGBA) sert de « carte » de houppier.
console.log('Feuillage LeafSet010');
const tmp = await mkdtemp(join(tmpdir(), 'pm3d-'));
execFileSync('unzip', ['-o', '-q', join(SRC, 'ambientcg', 'LeafSet010_1K-PNG.zip'), 'LeafSet010_1K-PNG_Color.png', 'LeafSet010_1K-PNG_Opacity.png', '-d', tmp]);
// Le PNG couleur d'ambientCG porte déjà l'opacité dans son canal alpha (identique à _Opacity.png).
const atlasRGBA = await sharp(join(tmp, 'LeafSet010_1K-PNG_Color.png')).ensureAlpha().png().toBuffer();
const meta = await sharp(atlasRGBA).metadata();
const demi = meta.width / 2;
const feuilles = [];
for (const [x, y] of [[0, 0], [demi, 0], [0, demi], [demi, demi]]) {
  // sharp applique trim avant extract dans une même chaîne : deux étapes séparées.
  const quart = await sharp(atlasRGBA).extract({ left: x, top: y, width: demi, height: demi }).png().toBuffer();
  feuilles.push(await sharp(quart).trim({ threshold: 1 }).png().toBuffer());
}
function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const C = 1024; // composition en 1024, réduite ensuite
const r = aleatoire(7);
const morceaux = [];
// Tige principale et petites tiges (SVG).
let tiges = '';
const pointsTige = [];
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  pointsTige.push([C * 0.5 + Math.sin(t * 2.4) * C * 0.06, C * (0.95 - t * 0.85)]);
}
tiges += `<polyline points="${pointsTige.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#5b4632" stroke-width="10" stroke-linecap="round"/>`;
const placements = [];
const N_FEUILLES = 34;
for (let i = 0; i < N_FEUILLES; i++) {
  const t = 0.1 + (i / N_FEUILLES) * 0.88;
  const base = pointsTige[Math.round(t * 10)];
  const cote = i % 2 ? 1 : -1;
  const longueur = C * (0.08 + r() * 0.12) * (1.1 - t * 0.4);
  const ang = cote * (35 + r() * 45) - 90 + (r() - 0.5) * 20;
  const ex = base[0] + Math.cos((ang * Math.PI) / 180) * longueur;
  const ey = base[1] + Math.sin((ang * Math.PI) / 180) * longueur;
  tiges += `<line x1="${base[0]}" y1="${base[1]}" x2="${ex}" y2="${ey}" stroke="#5e4a35" stroke-width="4" stroke-linecap="round"/>`;
  placements.push({ x: ex, y: ey, ang: ang + 90 + (r() - 0.5) * 40, echelle: 0.42 + r() * 0.2 + (1 - t) * 0.12 });
}
morceaux.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}">${tiges}</svg>`), left: 0, top: 0 });
for (const p of placements) {
  const f = feuilles[Math.floor(r() * feuilles.length)];
  const fm = await sharp(f).metadata();
  const w = Math.round(fm.width * p.echelle);
  // Platane en été : vert assez soutenu, feuilles du fond plus sombres.
  const teinte = 0.55 + r() * 0.35;
  const feuille = sharp(f).resize(w).modulate({ brightness: teinte, saturation: 0.62 + r() * 0.2, hue: Math.round(8 + (r() - 0.5) * 14) });
  const tournee = await feuille.rotate(p.ang, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const tm = await sharp(tournee).metadata();
  const left = Math.round(p.x - tm.width / 2);
  const top = Math.round(p.y - tm.height / 2);
  // On rogne ce qui dépasse plutôt que d'écarter la feuille.
  const x0 = Math.max(0, -left);
  const y0 = Math.max(0, -top);
  const larg = Math.min(tm.width - x0, C - Math.max(0, left));
  const haut = Math.min(tm.height - y0, C - Math.max(0, top));
  if (larg <= 8 || haut <= 8) continue;
  const rognee = await sharp(tournee).extract({ left: x0, top: y0, width: larg, height: haut }).png().toBuffer();
  morceaux.push({ input: rognee, left: Math.max(0, left), top: Math.max(0, top) });
}
const rameau = await sharp({ create: { width: C, height: C, channels: 4, background: { r: 60, g: 80, b: 40, alpha: 0 } } }).composite(morceaux).png().toBuffer();
// Les pixels transparents gardent une couleur feuillage (évite les franges sombres au filtrage).
for (const [q, px] of [['haute', 512], ['basse', 512]]) {
  // 512 px aussi en basse : à 256 px, le test alpha crénelait fortement les bords des feuilles.
  const buf = await sharp(rameau).resize(px, px).webp({ quality: 88, alphaQuality: 90 }).toBuffer();
  await ecrire(join(OUT, 'textures', 'feuillage', q, 'rameau.webp'), buf);
}
await rm(tmp, { recursive: true, force: true });

// ——————————————————————————————— HDRI
console.log('HDRI');
await mkdir(join(OUT, 'hdri'), { recursive: true });
for (const res of ['1k', '2k']) {
  const dest = join(OUT, 'hdri', `ciel-${res}.hdr`);
  await copyFile(join(SRC, 'polyhaven', 'kloofendal_38d_partly_cloudy_puresky', `${res}.hdr`), dest);
  console.log('  →', dest.replace(RACINE + '/', ''), await taille(dest));
}

// ——————————————————————————————— Modèles
async function optimiser(entree, sortie, { ratio = 1, texture = 1024, garderNoeuds = null, decalageX = 0, animations = null, erreur = 0.002 } = {}) {
  const doc = await io.read(entree);
  const racine = doc.getRoot();
  if (garderNoeuds) {
    for (const n of racine.listNodes()) {
      if (!garderNoeuds.includes(n.getName())) n.dispose();
      else if (decalageX) {
        const t = n.getTranslation();
        n.setTranslation([t[0] + decalageX, t[1], t[2]]);
      }
    }
  }
  if (animations) for (const a of racine.listAnimations()) if (!animations.includes(a.getName())) a.dispose();
  const etapes = [dedup(), prune()];
  if (ratio < 1) etapes.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: erreur }));
  if (animations) etapes.push(resample());
  if (racine.listTextures().length) etapes.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texture, texture], quality: 85 }));
  etapes.push(prune());
  await doc.transform(...etapes);
  await mkdir(dirname(sortie), { recursive: true });
  await io.write(sortie, doc);
  const tris = racine.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log('  →', sortie.replace(RACINE + '/', ''), await taille(sortie), `${Math.round(tris)} triangles`);
}

console.log('Modèles');
const lampe = join(SRC, 'polyhaven', 'street_lamp_01', 'street_lamp_01.gltf');
await optimiser(lampe, join(OUT, 'modeles', 'lampadaire-haute.glb'), { ratio: 0.5, texture: 512 });
await optimiser(lampe, join(OUT, 'modeles', 'lampadaire-basse.glb'), { ratio: 0.12, texture: 256 });

// Statue allégorique (figure drapée, couronne, livre et chaînes) pour le monument.
const statue = join(SRC, 'polyhaven', 'gothic_statue', 'gothic_statue.gltf');
await optimiser(statue, join(OUT, 'modeles', 'statue-haute.glb'), { ratio: 0.6, texture: 1024 });
await optimiser(statue, join(OUT, 'modeles', 'statue-basse.glb'), { ratio: 0.12, texture: 512, erreur: 0.01 });

// Banc droit : un seul module (pieds aux deux extrémités), recentré sur l'origine.
const MODULE_BANC = ['crossbar', 'legs_double', 'legs_single', 'suspended_support_01', 'back_support_r', 'back_support_l', 'arm_rest_01', 'arm_rest_02', 'seat', 'seat_back'];
const banc = join(SRC, 'polyhaven', 'modular_street_seating', 'modular_street_seating.gltf');
await optimiser(banc, join(OUT, 'modeles', 'banc-haute.glb'), { garderNoeuds: MODULE_BANC, decalageX: 1.16, texture: 512 });
await optimiser(banc, join(OUT, 'modeles', 'banc-basse.glb'), { garderNoeuds: MODULE_BANC, decalageX: 1.16, texture: 256, ratio: 0.2, erreur: 0.01 });

// Personnages Quaternius : préparés dans Blender (lissage, animations utilisées seulement) par
// blender/scripts/personnage.py → modeles/manifestant-lisse.glb et passant-lisse.glb.

// Licence d'origine du pack de personnages, conservée à côté des fichiers.
await copyFile(join(SRC, 'quaternius', 'License.txt'), join(OUT, 'modeles', 'LICENCE-Quaternius.txt'));
const manifeste = JSON.parse(await readFile(join(SRC, 'manifeste.json'), 'utf8'));
await ecrire(join(OUT, 'CREDITS.json'), Buffer.from(JSON.stringify(manifeste.elements, null, 2)));
console.log('Terminé.');
