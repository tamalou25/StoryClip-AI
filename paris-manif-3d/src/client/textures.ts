// Textures procédurales générées au chargement (canvas 2D) : aucune ressource externe, aucune licence tierce.
// Chaque matériau a une carte de couleur (sRGB), une carte de normales dérivée d'une carte de hauteur,
// et éventuellement une carte de brillance. Les échelles sont exprimées en mètres réels.

import * as pc from 'playcanvas';

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même rendu à chaque chargement. */
export function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Couches {
  couleur: HTMLCanvasElement;
  hauteur: Float32Array;
  brillance?: HTMLCanvasElement;
  largeur: number;
  hauteurPx: number;
}

function toile(l: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = l;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Bruit de valeur lissé, périodique (raccord parfait en mosaïque). */
function bruitPeriodique(l: number, h: number, cellule: number, graine: number): Float32Array {
  const r = alea(graine);
  const gx = Math.max(1, Math.round(l / cellule));
  const gy = Math.max(1, Math.round(h / cellule));
  const grille = new Float32Array(gx * gy).map(() => r());
  const sortie = new Float32Array(l * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * gy;
    const y0 = Math.floor(fy) % gy;
    const y1 = (y0 + 1) % gy;
    const ty = fy - Math.floor(fy);
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < l; x++) {
      const fx = (x / l) * gx;
      const x0 = Math.floor(fx) % gx;
      const x1 = (x0 + 1) % gx;
      const tx = fx - Math.floor(fx);
      const sx = tx * tx * (3 - 2 * tx);
      const a = grille[y0 * gx + x0]! + (grille[y0 * gx + x1]! - grille[y0 * gx + x0]!) * sx;
      const b = grille[y1 * gx + x0]! + (grille[y1 * gx + x1]! - grille[y1 * gx + x0]!) * sx;
      sortie[y * l + x] = a + (b - a) * sy;
    }
  }
  return sortie;
}

/** Somme de plusieurs octaves de bruit, résultat dans [0, 1] environ. */
function fbm(l: number, h: number, cellule: number, graine: number, octaves = 4): Float32Array {
  const sortie = new Float32Array(l * h);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = bruitPeriodique(l, h, Math.max(2, cellule / 2 ** o), graine + o * 101);
    for (let i = 0; i < n.length; i++) sortie[i]! += n[i]! * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < sortie.length; i++) sortie[i]! /= total;
  return sortie;
}

/** Ajoute un grain de couleur (variation de teinte) sur une toile déjà dessinée. */
function grain(ctx: CanvasRenderingContext2D, l: number, h: number, bruit: Float32Array, force: number): void {
  const img = ctx.getImageData(0, 0, l, h);
  const d = img.data;
  for (let i = 0; i < l * h; i++) {
    const v = (bruit[i]! - 0.5) * force;
    d[i * 4] = Math.max(0, Math.min(255, d[i * 4]! + v));
    d[i * 4 + 1] = Math.max(0, Math.min(255, d[i * 4 + 1]! + v));
    d[i * 4 + 2] = Math.max(0, Math.min(255, d[i * 4 + 2]! + v * 0.9));
  }
  ctx.putImageData(img, 0, 0);
}

/** Carte de normales (espace tangent) à partir d'une carte de hauteur périodique. */
export function normales(hauteur: Float32Array, l: number, h: number, force: number): HTMLCanvasElement {
  const [c, ctx] = toile(l, h);
  const img = ctx.createImageData(l, h);
  const d = img.data;
  const H = (x: number, y: number) => hauteur[((y + h) % h) * l + ((x + l) % l)]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * force;
      const dy = (H(x, y + 1) - H(x, y - 1)) * force;
      const n = 1 / Math.hypot(dx, dy, 1);
      const i = (y * l + x) * 4;
      d[i] = (-dx * n * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * n * 0.5 + 0.5) * 255;
      d[i + 2] = (n * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}




// ——————————————————————————————————————————————— Façades


/** Garde-corps en fer forgé (motif répété, transparence) : 1,5 m × 1 m. */
export function gardeCorps(px = 256): HTMLCanvasElement {
  const l = px;
  const h = Math.round(px * (1 / 1.5));
  const [c, ctx] = toile(l, h);
  ctx.clearRect(0, 0, l, h);
  ctx.strokeStyle = '#1d1f20';
  ctx.fillStyle = '#1d1f20';
  ctx.lineWidth = 3;
  ctx.fillRect(0, 0, l, 7);
  ctx.fillRect(0, h - 6, l, 6);
  ctx.fillRect(0, h * 0.82, l, 3);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (l / n);
    ctx.fillRect(x - 1.5, 7, 3, h - 13);
    ctx.beginPath();
    ctx.ellipse(x + l / n / 2, h * 0.45, l / n / 2 - 4, h * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + l / n / 2, h * 0.45, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}


/**
 * Joints d'assise de la pierre de taille (calcaire parisien) : assises de 0,5 m, blocs de 0,8 à 1,4 m
 * décalés, légère variation de ton par bloc. Sert de carte de détail (multiplication) sur la pierre.
 * Toile = 2 m × 2 m.
 */
export function jointsPierre(px = 512): Couches {
  const metres = 2;
  const ppm = px / metres;
  const [c, ctx] = toile(px, px);
  const hauteur = new Float32Array(px * px).fill(1);
  const r = alea(97);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  const assise = 0.5 * ppm;
  const joint = Math.max(1, Math.round(0.006 * ppm));
  for (let rang = 0; rang < metres / 0.5; rang++) {
    const y0 = Math.round(rang * assise);
    let x = -r() * ppm;
    while (x < px) {
      const longueur = (0.8 + r() * 0.6) * ppm;
      const ton = 243 + Math.floor(r() * 12);
      ctx.fillStyle = `rgb(${ton},${ton - 2},${ton - 5})`;
      for (const decal of [-px, 0, px]) ctx.fillRect(x + decal, y0, longueur, assise);
      ctx.fillStyle = 'rgb(206,199,187)';
      for (const decal of [-px, 0, px]) ctx.fillRect(x + decal, y0, joint, assise);
      for (let yy = y0; yy < y0 + assise && yy < px; yy++) for (let k = 0; k < joint; k++) {
        const xx = ((Math.round(x) + k) % px + px) % px;
        hauteur[yy * px + xx] = 0;
      }
      x += longueur;
    }
    ctx.fillStyle = 'rgb(206,199,187)';
    ctx.fillRect(0, y0, px, joint);
    for (let yy = y0; yy < y0 + joint && yy < px; yy++) for (let xx = 0; xx < px; xx++) hauteur[yy * px + xx] = 0;
  }
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

/** Une devanture fictive (bois peint, enseigne, vitrine éclairée, soubassement). */
const ENSEIGNES = ['CAFÉ DU CANAL', 'BOULANGERIE', 'LIBRAIRIE', 'PHARMACIE', 'FLEURISTE', 'BRASSERIE', 'TABAC PRESSE', 'OPTICIEN'];
const BOIS_DEVANTURE = ['#22362c', '#4f1d22', '#1e2b40', '#1b1b1b', '#3a2a1f', '#2f4547', '#5b4a2e', '#3d2433'];

/**
 * Atlas de 8 devantures (4 × 2 cellules de 256 × 400 px), couleur et brillance.
 * Chaque cellule couvre la baie de boutique du kit (2,3 × 3,55 m), UV 0–1.
 */
export function devantures(echelle = 1): { couleur: HTMLCanvasElement; brillance: HTMLCanvasElement } {
  const cw = Math.round(256 * echelle);
  const ch = Math.round(400 * echelle);
  const [c, g] = toile(cw * 4, ch * 2);
  const [cb, gb] = toile(cw * 4, ch * 2);
  const r = alea(131);
  const ppm = ch / 3.55;
  for (let i = 0; i < 8; i++) {
    const x0 = (i % 4) * cw;
    const y0 = Math.floor(i / 4) * ch;
    const bois = BOIS_DEVANTURE[i]!;
    g.fillStyle = bois;
    g.fillRect(x0, y0, cw, ch);
    gb.fillStyle = 'rgb(95,95,95)';
    gb.fillRect(x0, y0, cw, ch);
    // Enseigne (bandeau 0,55 m) : lettres claires à empattements.
    const hb = 0.55 * ppm;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x0 + 6 * echelle, y0 + 6 * echelle, cw - 12 * echelle, hb - 8 * echelle);
    g.fillStyle = i === 6 ? '#e8c35a' : '#efe4c8';
    g.font = `600 ${Math.round(0.2 * ppm)}px Georgia, 'Times New Roman', serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ENSEIGNES[i]!, x0 + cw / 2, y0 + hb / 2 + 1, cw - 24 * echelle);
    // Vitrine (deux châssis) et porte vitrée centrale.
    const yv = y0 + hb + 10 * echelle;
    const hv = ch - hb - 0.5 * ppm - 10 * echelle;
    const montant = Math.max(2, Math.round(8 * echelle));
    const largeurs = [0.36, 0.28, 0.36].map((f) => f * (cw - 4 * montant));
    let x = x0 + montant;
    largeurs.forEach((w, k) => {
      const porte = k === 1;
      const h = porte ? ch - hb - 14 * echelle : hv;
      const grad = g.createLinearGradient(0, yv, 0, yv + h);
      grad.addColorStop(0, porte ? '#2a2620' : '#a08a64');
      grad.addColorStop(0.55, porte ? '#1e1b17' : '#6c5a42');
      grad.addColorStop(1, porte ? '#14120f' : '#3c3226');
      g.fillStyle = grad;
      g.fillRect(x, yv, w, h);
      if (!porte) {
        // Silhouettes d'étagères et de luminaires derrière la vitre.
        g.fillStyle = 'rgba(40,30,20,0.35)';
        for (let e = 1; e < 4; e++) g.fillRect(x + 4 * echelle, yv + (h * e) / 4, w - 8 * echelle, Math.max(1, 3 * echelle));
        g.fillStyle = 'rgba(255,226,170,0.55)';
        g.beginPath();
        g.arc(x + w / 2, yv + 14 * echelle, (5 + r() * 3) * echelle, 0, Math.PI * 2);
        g.fill();
      }
      // Reflet du ciel dans le haut de la vitre.
      const reflet = g.createLinearGradient(x, yv, x + w, yv + h * 0.6);
      reflet.addColorStop(0, 'rgba(200,215,230,0.28)');
      reflet.addColorStop(1, 'rgba(200,215,230,0)');
      g.fillStyle = reflet;
      g.fillRect(x, yv, w, h * 0.6);
      gb.fillStyle = 'rgb(235,235,235)';
      gb.fillRect(x, yv, w, h);
      x += w + montant;
    });
    // Soubassement à panneaux moulurés.
    const ys = y0 + ch - 0.5 * ppm;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = Math.max(1, 2 * echelle);
    g.strokeRect(x0 + 14 * echelle, ys + 8 * echelle, cw * 0.36 - 10 * echelle, 0.5 * ppm - 18 * echelle);
    g.strokeRect(x0 + cw - 14 * echelle - (cw * 0.36 - 10 * echelle), ys + 8 * echelle, cw * 0.36 - 10 * echelle, 0.5 * ppm - 18 * echelle);
  }
  return { couleur: c, brillance: cb };
}

/**
 * Toiles de stores bannes : 4 variantes empilées (bandes verticales, lambrequin plus sombre en bas).
 * Variante i : v ∈ [i/4, (i+1)/4] ; u = largeur du store.
 */
export function toilesStores(): HTMLCanvasElement {
  const l = 256;
  const h = 64;
  const [c, g] = toile(l, h * 4);
  const variantes: [string, string][] = [['#2f5a44', '#ece6d6'], ['#8c2a25', '#efe7d6'], ['#22324f', '#e8e0cc'], ['#6a1f2e', '#6a1f2e']];
  variantes.forEach(([a, b], i) => {
    const y0 = i * h;
    const bandes = 12;
    for (let k = 0; k < bandes; k++) {
      g.fillStyle = k % 2 ? b : a;
      g.fillRect((k * l) / bandes, y0, l / bandes + 1, h);
    }
    // Lambrequin (dernier quart en v) : bord plus sombre, comme une toile plus épaisse.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, y0 + h * 0.8, l, h * 0.2);
    // Usure légère de la toile.
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 40; k++) g.fillRect(((k * 53) % l), y0 + ((k * 29) % h), 6, 1);
  });
  return c;
}

/** Zinc de toiture (bleu-gris) avec tasseaux verticaux tous les 0,5 m. Toile = 2 m. */
export function zinc(px = 128): Couches {
  const [c, ctx] = toile(px, px);
  ctx.fillStyle = '#7b858f';
  ctx.fillRect(0, 0, px, px);
  const hauteur = new Float32Array(px * px).fill(0.3);
  for (let x = 0; x < px; x += px / 4) {
    ctx.fillStyle = '#9aa3ab';
    ctx.fillRect(x, 0, 3, px);
    ctx.fillStyle = 'rgba(40,46,52,0.5)';
    ctx.fillRect(x + 3, 0, 2, px);
    for (let y = 0; y < px; y++) for (let k = 0; k < 3; k++) hauteur[y * px + ((x + k) | 0)] = 1;
  }
  grain(ctx, px, px, fbm(px, px, 24, 53, 3), 24);
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}



/** Bronze patiné (vert-de-gris dans les creux). */
export function bronze(px = 128): Couches {
  const [c, ctx] = toile(px, px);
  const n = fbm(px, px, 24, 81, 4);
  const img = ctx.createImageData(px, px);
  for (let i = 0; i < px * px; i++) {
    const v = n[i]!;
    // Bronze sombre, patine vert-de-gris discrète seulement dans les creux.
    const vert = Math.max(0, (v - 0.62) * 1.6);
    const base = 0.85 + v * 0.3;
    img.data[i * 4] = (70 * (1 - vert) + 70 * vert) * base;
    img.data[i * 4 + 1] = (52 * (1 - vert) + 92 * vert) * base;
    img.data[i * 4 + 2] = (34 * (1 - vert) + 78 * vert) * base;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { couleur: c, hauteur: n, largeur: px, hauteurPx: px };
}


/** Ombre de contact douce (disque radial), utilisée sous le personnage. */
export function ombreContact(px = 64): HTMLCanvasElement {
  const [c, ctx] = toile(px, px);
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  return c;
}

/** Affiche fictive pour la colonne d'affichage. */
export function affiche(graine: number): HTMLCanvasElement {
  const [c, ctx] = toile(128, 192);
  const r = alea(graine);
  const fonds = ['#c9b38a', '#a8443a', '#2f4a6b', '#e2d6b8', '#3d5a45'];
  ctx.fillStyle = fonds[Math.floor(r() * fonds.length)]!;
  ctx.fillRect(0, 0, 128, 192);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 22px Georgia, serif';
  ctx.textAlign = 'center';
  const titres = ['CONCERT', 'THÉÂTRE', 'EXPOSITION', 'CINÉMA', 'BAL'];
  ctx.fillText(titres[Math.floor(r() * titres.length)]!, 64, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(16, 70, 96, 70);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px sans-serif';
  ctx.fillText('SAMEDI 21 H', 64, 165);
  return c;
}

// ——————————————————————————————————————————————— Conversion en textures PlayCanvas

export function texture(device: pc.GraphicsDevice, source: HTMLCanvasElement, srgb: boolean, anisotropie: number, repeter = true): pc.Texture {
  const t = new pc.Texture(device, {
    width: source.width,
    height: source.height,
    format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: repeter ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: repeter ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    anisotropy: anisotropie,
  });
  t.setSource(source);
  return t;
}

export interface OptionsMateriau {
  /** Mètres couverts par la texture (u, v) : les UV des maillages sont en mètres. */
  metres: [number, number];
  gloss?: number;
  metalness?: number;
  normaleForce?: number;
  bumpiness?: number;
  teinte?: pc.Color;
  normales?: boolean;
}

/** Fabrique un matériau PBR (métallicité) à partir de couches procédurales. */
export function materiauCouches(device: pc.GraphicsDevice, couches: Couches, o: OptionsMateriau, anisotropie: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useMetalness = true;
  m.metalness = o.metalness ?? 0;
  m.gloss = o.gloss ?? 0.25;
  m.diffuseMap = texture(device, couches.couleur, true, anisotropie);
  if (o.teinte) m.diffuse = o.teinte;
  const tiling = new pc.Vec2(1 / o.metres[0], 1 / o.metres[1]);
  m.diffuseMapTiling = tiling;
  if (o.normales !== false) {
    m.normalMap = texture(device, normales(couches.hauteur, couches.largeur, couches.hauteurPx, o.normaleForce ?? 3), false, anisotropie);
    m.normalMapTiling = tiling;
    m.bumpiness = o.bumpiness ?? 1;
  }
  if (couches.brillance) {
    m.glossMap = texture(device, couches.brillance, false, anisotropie);
    m.glossMapChannel = 'g';
    m.glossMapTiling = tiling;
    m.glossInvert = false;
  }
  m.update();
  return m;
}
