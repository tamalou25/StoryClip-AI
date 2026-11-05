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

// ——————————————————————————————————————————————— Sols

/** Dalles de pierre calcaire posées en quinconce (0,6 × 1,2 m). Toile = 4,8 m × 4,8 m. */
export function dalles(px = 512): Couches {
  const metres = 4.8;
  const ppm = px / metres;
  const [c, ctx] = toile(px, px);
  const r = alea(7);
  const hauteur = new Float32Array(px * px).fill(1);
  const rangs = Math.round(metres / 0.6);
  for (let rang = 0; rang < rangs; rang++) {
    const y0 = Math.round(rang * 0.6 * ppm);
    const y1 = Math.round((rang + 1) * 0.6 * ppm);
    const decalage = rang % 2 ? 0.6 : 0;
    for (let k = -1; k < metres / 1.2 + 1; k++) {
      const x0 = Math.round((k * 1.2 + decalage) * ppm);
      const x1 = Math.round(((k + 1) * 1.2 + decalage) * ppm);
      const t = 158 + r() * 26;
      const chaud = 6 + r() * 10;
      ctx.fillStyle = `rgb(${t + chaud},${t + chaud * 0.55 - 3},${t - 12})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Joints : 1 cm environ, légèrement plus sombres et en creux.
      // Joint ≈ 8 mm quelle que soit la résolution.
      const j = Math.max(1, Math.round(0.008 * ppm));
      ctx.fillStyle = `rgba(96,88,76,${j === 1 ? 0.3 : 0.42})`;
      ctx.fillRect(x0, y0, j, y1 - y0);
      ctx.fillRect(x0, y0, x1 - x0, j);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + j; x++) hauteur[y * px + ((x % px) + px) % px] = 0;
      for (let x = x0; x < x1; x++) for (let y = y0; y < y0 + j; y++) hauteur[y * px + ((x % px) + px) % px] = 0;
    }
  }
  const salissure = fbm(px, px, 128, 11, 5);
  grain(ctx, px, px, salissure, 34);
  const fin = fbm(px, px, 6, 13, 2);
  grain(ctx, px, px, fin, 10);
  for (let i = 0; i < hauteur.length; i++) hauteur[i] = hauteur[i]! * 0.9 + fin[i]! * 0.1;
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

/** Pavés de granit (≈ 14 cm) en rangs, pour bordures et trottoirs. Toile = 1,4 m. */
export function paves(px = 256): Couches {
  const metres = 1.4;
  const ppm = px / metres;
  const [c, ctx] = toile(px, px);
  const r = alea(21);
  const hauteur = new Float32Array(px * px);
  ctx.fillStyle = '#3f3c39';
  ctx.fillRect(0, 0, px, px);
  const taille = 0.14 * ppm;
  for (let rang = 0; rang < 10; rang++) {
    const dec = rang % 2 ? taille / 2 : 0;
    for (let k = -1; k < 11; k++) {
      const x = k * taille + dec + 1.5;
      const y = rang * taille + 1.5;
      const t = 105 + r() * 45;
      ctx.fillStyle = `rgb(${t},${t - 3},${t - 6})`;
      const rayon = 3;
      ctx.beginPath();
      ctx.roundRect(x, y, taille - 3, taille - 3, rayon);
      ctx.fill();
      for (let yy = Math.floor(y); yy < y + taille - 3; yy++)
        for (let xx = Math.floor(x); xx < x + taille - 3; xx++) {
          const bx = Math.min(xx - x, x + taille - 3 - xx, yy - y, y + taille - 3 - yy);
          hauteur[(yy % px) * px + ((xx % px) + px) % px] = Math.min(1, bx / 4);
        }
    }
  }
  grain(ctx, px, px, fbm(px, px, 8, 23, 3), 30);
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

/** Enrobé (asphalte) avec granulats et légères traces. Toile = 6 m. */
export function asphalte(px = 256): Couches {
  const [c, ctx] = toile(px, px);
  ctx.fillStyle = '#4b4d51';
  ctx.fillRect(0, 0, px, px);
  const gros = fbm(px, px, 96, 31, 4);
  const fin = fbm(px, px, 3, 37, 2);
  grain(ctx, px, px, gros, 26);
  grain(ctx, px, px, fin, 30);
  const hauteur = new Float32Array(px * px).map((_, i) => fin[i]!);
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

// ——————————————————————————————————————————————— Façades

const PIERRE = [222, 210, 186];

/**
 * Une travée d'étage haussmannien : 3 m de large × 3,1 m de haut, porte-fenêtre centrale,
 * encadrement mouluré, appui, assises de pierre de taille. Couleur, hauteur et brillance.
 */
export function travee(px = 256): Couches {
  const l = px;
  const h = Math.round(px * (3.1 / 3));
  const ppm = l / 3;
  const [c, ctx] = toile(l, h);
  const [cb, cbx] = toile(l, h);
  const hauteur = new Float32Array(l * h).fill(0.6);
  const peindre = (x: number, y: number, w: number, hh: number, couleur: string, haut: number, brillance = 30) => {
    ctx.fillStyle = couleur;
    ctx.fillRect(x, y, w, hh);
    cbx.fillStyle = `rgb(${brillance},${brillance},${brillance})`;
    cbx.fillRect(x, y, w, hh);
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + hh); yy++)
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(l, x + w); xx++) hauteur[yy * l + xx] = haut;
  };

  // Pierre de taille : assises de 0,5 m, joints fins.
  peindre(0, 0, l, h, `rgb(${PIERRE.join(',')})`, 0.6, 40);
  ctx.fillStyle = 'rgba(120,108,88,0.35)';
  for (let y = 0; y < h; y += 0.5 * ppm) {
    ctx.fillRect(0, Math.round(y), l, 1);
    for (let yy = Math.round(y); yy < Math.round(y) + 1 && yy < h; yy++) for (let x = 0; x < l; x++) hauteur[yy * l + x] = 0.5;
  }

  // Porte-fenêtre : 1,25 m × 2,35 m, linteau à 2,65 m.
  const fx = (3 - 1.25) / 2 * ppm;
  const fw = 1.25 * ppm;
  const fy = (3.1 - 2.65) * ppm;
  const fh = 2.35 * ppm;
  // Encadrement mouluré (chambranle) et clé.
  peindre(fx - 0.14 * ppm, fy - 0.16 * ppm, fw + 0.28 * ppm, fh + 0.16 * ppm, 'rgb(230,220,198)', 0.8, 45);
  peindre(l / 2 - 0.12 * ppm, fy - 0.3 * ppm, 0.24 * ppm, 0.22 * ppm, 'rgb(232,222,200)', 0.9, 45);
  // Embrasure (ombre) puis vitrage.
  peindre(fx, fy, fw, fh, 'rgb(70,64,58)', 0.15, 20);
  const vitre = ctx.createLinearGradient(0, fy, 0, fy + fh);
  vitre.addColorStop(0, '#93a8b8');
  vitre.addColorStop(0.45, '#4d6273');
  vitre.addColorStop(1, '#2a3540');
  const cadre = 0.06 * ppm;
  ctx.fillStyle = vitre;
  ctx.fillRect(fx + cadre, fy + cadre, fw - 2 * cadre, fh - 2 * cadre);
  cbx.fillStyle = 'rgb(235,235,235)';
  cbx.fillRect(fx + cadre, fy + cadre, fw - 2 * cadre, fh - 2 * cadre);
  // Rideaux discrets, imposte, montants et petits-bois (bois peint crème).
  ctx.fillStyle = 'rgba(236,228,210,0.45)';
  ctx.fillRect(fx + cadre, fy + 0.5 * ppm, 0.22 * ppm, fh - 0.6 * ppm);
  ctx.fillRect(fx + fw - cadre - 0.22 * ppm, fy + 0.5 * ppm, 0.22 * ppm, fh - 0.6 * ppm);
  const bois = 'rgb(232,228,218)';
  peindre(fx, fy, fw, cadre, bois, 0.35, 60);
  peindre(fx, fy + fh - cadre, fw, cadre, bois, 0.35, 60);
  peindre(fx, fy, cadre, fh, bois, 0.35, 60);
  peindre(fx + fw - cadre, fy, cadre, fh, bois, 0.35, 60);
  peindre(l / 2 - cadre / 2, fy + 0.45 * ppm, cadre, fh - 0.45 * ppm, bois, 0.35, 60);
  peindre(fx, fy + 0.45 * ppm, fw, cadre * 0.8, bois, 0.35, 60);
  for (const k of [1, 2, 3]) peindre(fx, fy + 0.45 * ppm + (k * (fh - 0.45 * ppm)) / 4, fw, 2, bois, 0.33, 60);
  // Bandeau d'étage (corniche légère) en bas de la travée.
  peindre(0, h - 0.12 * ppm, l, 0.12 * ppm, 'rgb(214,202,178)', 0.85, 40);
  ctx.fillStyle = 'rgba(80,70,55,0.35)';
  ctx.fillRect(0, h - 0.12 * ppm - 2, l, 2);

  // Salissures verticales (coulures) et variation de la pierre.
  const sale = fbm(l, h, 40, 41, 4);
  grain(ctx, l, h, sale, 26);
  const coulures = document.createElement('canvas');
  coulures.width = l;
  coulures.height = h;
  const cc = coulures.getContext('2d')!;
  const r = alea(43);
  for (let i = 0; i < 18; i++) {
    const x = r() * l;
    const g = cc.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(60,55,45,0)');
    g.addColorStop(0.7, `rgba(60,55,45,${0.05 + r() * 0.06})`);
    g.addColorStop(1, 'rgba(60,55,45,0)');
    cc.fillStyle = g;
    cc.fillRect(x, 0, 2 + r() * 6, h);
  }
  ctx.drawImage(coulures, 0, 0);
  const fin = fbm(l, h, 4, 47, 2);
  for (let i = 0; i < hauteur.length; i++) hauteur[i] = hauteur[i]! + (fin[i]! - 0.5) * 0.04;
  return { couleur: c, hauteur, brillance: cb, largeur: l, hauteurPx: h };
}

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

/** Rez-de-chaussée commercial (fictif) : arcades, vitrines, enseignes inventées. Hauteur 4,6 m. */
export function rezDeChaussee(longueur: number, graine: number, ppm = 40): Couches {
  const l = Math.round(longueur * ppm);
  const h = Math.round(4.6 * ppm);
  const [c, ctx] = toile(l, h);
  const [cb, cbx] = toile(l, h);
  const hauteur = new Float32Array(l * h).fill(0.7);
  const r = alea(graine);
  ctx.fillStyle = `rgb(${PIERRE[0]! - 8},${PIERRE[1]! - 8},${PIERRE[2]! - 10})`;
  ctx.fillRect(0, 0, l, h);
  cbx.fillStyle = 'rgb(40,40,40)';
  cbx.fillRect(0, 0, l, h);
  // Bossages (refends horizontaux) caractéristiques du soubassement.
  ctx.fillStyle = 'rgba(110,98,80,0.5)';
  for (let y = 0.45 * ppm; y < h; y += 0.45 * ppm) ctx.fillRect(0, y, l, 2);

  const enseignes = ['CAFÉ DU CANAL', 'LIBRAIRIE', 'BOULANGERIE', 'PHARMACIE', 'BRASSERIE', 'FLEURS', 'TABAC PRESSE', 'OPTIQUE'];
  const couleursVitrine = ['#24372f', '#5a1f1f', '#1f2c45', '#3b2a1e', '#2c2c2c'];
  const travees = Math.max(1, Math.round(longueur / 3));
  const pas = l / travees;
  let enseigneEnCours = -1;
  for (let i = 0; i < travees; i++) {
    const x = i * pas + pas * 0.12;
    const w = pas * 0.76;
    const y = 0.55 * ppm;
    const hh = h - 0.55 * ppm;
    if (i % 3 === 0) enseigneEnCours = Math.floor(r() * enseignes.length);
    const entree = i % 3 === 1;
    const teinte = couleursVitrine[(enseigneEnCours + graine) % couleursVitrine.length]!;
    // Devanture en bois peint.
    ctx.fillStyle = teinte;
    ctx.fillRect(x, y, w, hh);
    for (let yy = Math.floor(y); yy < h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) hauteur[yy * l + xx] = 0.35;
    // Bandeau d'enseigne.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y, w, 0.5 * ppm);
    // Vitrage intérieur éclairé chaud.
    const g = ctx.createLinearGradient(0, y + 0.7 * ppm, 0, h);
    g.addColorStop(0, entree ? '#2b2620' : '#9a8a6c');
    g.addColorStop(1, entree ? '#15120f' : '#4a3f30');
    ctx.fillStyle = g;
    ctx.fillRect(x + 0.1 * ppm, y + 0.7 * ppm, w - 0.2 * ppm, hh - (entree ? 0.75 : 1.25) * ppm);
    cbx.fillStyle = 'rgb(220,220,220)';
    cbx.fillRect(x + 0.1 * ppm, y + 0.7 * ppm, w - 0.2 * ppm, hh - 1.25 * ppm);
    if (!entree) {
      // Allège basse et meneau.
      ctx.fillStyle = teinte;
      ctx.fillRect(x, h - 0.55 * ppm, w, 0.55 * ppm);
      ctx.fillRect(x + w / 2 - 2, y + 0.7 * ppm, 4, hh);
    }
  }
  // Enseignes par groupe de trois travées.
  ctx.font = `600 ${Math.round(0.28 * ppm)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r2 = alea(graine);
  for (let g = 0; g < travees; g += 3) {
    const nom = enseignes[Math.floor(r2() * enseignes.length)]!;
    const cx = (g + Math.min(3, travees - g) / 2) * pas;
    ctx.fillStyle = '#e9dcc0';
    ctx.fillText(nom, cx, 0.55 * ppm + 0.26 * ppm);
  }
  grain(ctx, l, h, fbm(l, h, 32, graine + 3, 3), 18);
  return { couleur: c, hauteur, brillance: cb, largeur: l, hauteurPx: h };
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

/** Écorce de platane : plaques claires et sombres. Toile = 1 m. */
export function ecorce(px = 128): Couches {
  const [c, ctx] = toile(px, px);
  const plaques = fbm(px, px, 22, 61, 3);
  const img = ctx.createImageData(px, px);
  const hauteur = new Float32Array(px * px);
  for (let i = 0; i < px * px; i++) {
    const v = plaques[i]!;
    const clair = v > 0.52;
    const t = clair ? 128 + v * 40 : 82 + v * 30;
    img.data[i * 4] = t;
    img.data[i * 4 + 1] = t - (clair ? 4 : 10);
    img.data[i * 4 + 2] = t - (clair ? 22 : 24);
    img.data[i * 4 + 3] = 255;
    hauteur[i] = clair ? 0.8 : 0.3;
  }
  ctx.putImageData(img, 0, 0);
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

/** Feuillage : taches de feuilles claires et sombres, fond légèrement ajouré. */
export function feuillage(px = 256): Couches {
  const [c, ctx] = toile(px, px);
  const r = alea(71);
  ctx.fillStyle = '#3d4f2e';
  ctx.fillRect(0, 0, px, px);
  const hauteur = new Float32Array(px * px).fill(0.2);
  for (let i = 0; i < 2200; i++) {
    const x = r() * px;
    const y = r() * px;
    const t = r();
    ctx.fillStyle = t > 0.7 ? '#76875a' : t > 0.35 ? '#56693f' : '#33432a';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + r() * 4, 2 + r() * 2.5, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    const rr = 4;
    for (let yy = -rr; yy <= rr; yy++) for (let xx = -rr; xx <= rr; xx++) {
      const ix = (((x + xx) | 0) % px + px) % px;
      const iy = (((y + yy) | 0) % px + px) % px;
      hauteur[iy * px + ix] = Math.max(hauteur[iy * px + ix]!, 1 - Math.hypot(xx, yy) / rr);
    }
  }
  return { couleur: c, hauteur, largeur: px, hauteurPx: px };
}

/** Bronze patiné (vert-de-gris dans les creux). */
export function bronze(px = 128): Couches {
  const [c, ctx] = toile(px, px);
  const n = fbm(px, px, 24, 81, 4);
  const img = ctx.createImageData(px, px);
  for (let i = 0; i < px * px; i++) {
    const v = n[i]!;
    const vert = Math.max(0, (v - 0.5) * 2.2);
    img.data[i * 4] = 92 * (1 - vert) + 88 * vert;
    img.data[i * 4 + 1] = 74 * (1 - vert) + 128 * vert;
    img.data[i * 4 + 2] = 50 * (1 - vert) + 108 * vert;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { couleur: c, hauteur: n, largeur: px, hauteurPx: px };
}

/** Ciel : dégradé vertical doux avec voile de nuages. Toile panoramique (u = azimut, v = hauteur). */
export function ciel(l = 512, h = 256): HTMLCanvasElement {
  const [c, ctx] = toile(l, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5d86b8');
  g.addColorStop(0.42, '#8fb0d4');
  g.addColorStop(0.5, '#cad9e6');
  g.addColorStop(0.53, '#d9d8d0');
  g.addColorStop(1, '#a9a69b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, l, h);
  const nuages = fbm(l, h, 90, 91, 5);
  const img = ctx.getImageData(0, 0, l, h);
  for (let y = 0; y < h * 0.5; y++) {
    const masque = Math.sin((y / (h * 0.5)) * Math.PI) ** 1.5;
    for (let x = 0; x < l; x++) {
      const i = y * l + x;
      const a = Math.max(0, nuages[i]! - 0.52) * 2.4 * masque;
      img.data[i * 4] = img.data[i * 4]! + (250 - img.data[i * 4]!) * a;
      img.data[i * 4 + 1] = img.data[i * 4 + 1]! + (248 - img.data[i * 4 + 1]!) * a;
      img.data[i * 4 + 2] = img.data[i * 4 + 2]! + (244 - img.data[i * 4 + 2]!) * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
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
