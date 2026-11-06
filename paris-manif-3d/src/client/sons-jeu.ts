// Sons des événements de partie, synthétisés (aucun fichier) : zone prise ou perdue, slogan, gaz,
// dispersion, retour, décompte final, victoire et défaite. Tout passe par le bus « effets » de Son.

import type { Son } from './son';

export class SonsJeu {
  constructor(private readonly son: Son) {}

  private note(freq: number, duree: number, volume: number, type: OscillatorType = 'sine', delai = 0, glisse?: number): void {
    const s = this.son.sortieEffets();
    if (!s) return;
    const t = s.ctx.currentTime + delai;
    const o = s.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glisse) o.frequency.exponentialRampToValueAtTime(glisse, t + duree);
    const g = s.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + duree);
    o.connect(g).connect(s.bus);
    o.start(t);
    o.stop(t + duree + 0.02);
  }

  private souffle(duree: number, volume: number, freq: number, q = 0.8, delai = 0): void {
    const s = this.son.sortieEffets();
    if (!s) return;
    const t = s.ctx.currentTime + delai;
    const b = s.ctx.createBuffer(1, Math.ceil(s.ctx.sampleRate * duree), s.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = s.ctx.createBufferSource();
    src.buffer = b;
    const f = s.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = s.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + duree * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, t + duree);
    src.connect(f).connect(g).connect(s.bus);
    src.start(t);
  }

  zonePrise(pourNous: boolean): void {
    if (pourNous) { this.note(523, 0.18, 0.12, 'triangle'); this.note(784, 0.28, 0.12, 'triangle', 0.12); }
    else { this.note(392, 0.22, 0.12, 'triangle'); this.note(262, 0.35, 0.12, 'triangle', 0.14); }
  }

  slogan(distance: number): void {
    const v = Math.max(0.03, 0.22 - distance * 0.006);
    this.souffle(0.5, v, 700, 0.5);
    this.souffle(0.45, v * 0.9, 900, 0.6, 0.35);
    this.note(330, 0.3, v * 0.5, 'sawtooth', 0, 392);
  }

  gaz(distance: number): void {
    const v = Math.max(0.03, 0.2 - distance * 0.005);
    this.note(180, 0.12, v, 'square', 0, 90);
    this.souffle(1.6, v, 2200, 0.4, 0.1);
  }

  disperse(estJoueur: boolean): void {
    this.note(140, 0.4, estJoueur ? 0.2 : 0.07, 'sine', 0, 50);
    if (estJoueur) this.souffle(0.8, 0.12, 400, 0.4);
  }

  retour(): void { this.note(660, 0.1, 0.08, 'triangle'); this.note(880, 0.14, 0.08, 'triangle', 0.1); }

  contact(): void { this.note(220, 0.06, 0.03, 'square'); }

  decompte(dernier: boolean): void { this.note(dernier ? 1047 : 880, dernier ? 0.5 : 0.08, 0.1, 'sine'); }

  fin(victoire: boolean): void {
    const notes = victoire ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.note(f, i === notes.length - 1 ? 0.9 : 0.25, 0.13, 'triangle', i * 0.18));
  }

  clic(): void { this.note(1200, 0.05, 0.05, 'sine'); }
}
