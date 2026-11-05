// Ambiance sonore synthétisée en direct (Web Audio) : aucun fichier audio, aucune licence tierce.
// - Rumeur urbaine (circulation lointaine), murmure de foule discret, oiseaux, passages de véhicules.
// - Pas sur la pierre, déclenchés par l'animation.
// Le contexte audio n'est créé qu'après un geste de l'utilisateur (règle des navigateurs).

export class Son {
  private ctx: AudioContext | null = null;
  private maitre: GainNode | null = null;
  /** Bus des effets de jeu (volume réglable à part de l'ambiance). */
  private busEffets: GainNode | null = null;
  private volumeAmbiance = 0.9;
  private volumeEffets = 1;
  private bruit: AudioBuffer | null = null;
  private minuterie: number | null = null;
  actif = true;

  /** À appeler dans un gestionnaire de clic / touche (geste utilisateur). */
  demarrer(): void {
    if (!this.actif) return;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.maitre = this.ctx.createGain();
    this.maitre.gain.value = 0;
    this.maitre.gain.linearRampToValueAtTime(this.volumeAmbiance, this.ctx.currentTime + 1.5); // fondu d'entrée
    this.maitre.connect(this.ctx.destination);
    this.busEffets = this.ctx.createGain();
    this.busEffets.gain.value = this.volumeEffets;
    this.busEffets.connect(this.ctx.destination);
    this.bruit = this.creerBruit(4);
    this.rumeur();
    this.murmure();
    this.planifier();
  }

  /** Contexte et bus des effets, pour les sons de jeu (null tant que l'audio n'a pas démarré). */
  sortieEffets(): { ctx: AudioContext; bus: GainNode } | null {
    if (!this.ctx || !this.busEffets || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, bus: this.busEffets };
  }

  /** Volumes ∈ [0, 1] : ambiance (rumeur, pas) et effets de jeu. */
  reglerVolumes(ambiance: number, effets: number): void {
    this.volumeAmbiance = ambiance * 0.9;
    this.volumeEffets = effets;
    if (this.ctx && this.maitre && this.busEffets) {
      this.maitre.gain.setTargetAtTime(this.volumeAmbiance, this.ctx.currentTime, 0.05);
      this.busEffets.gain.setTargetAtTime(this.volumeEffets, this.ctx.currentTime, 0.05);
    }
  }

  /** État du contexte audio (diagnostic et tests). */
  etat(): string {
    return this.ctx?.state ?? 'non démarré';
  }

  suspendre(): void {
    void this.ctx?.suspend();
  }

  basculer(): boolean {
    this.actif = !this.actif;
    if (!this.actif) this.suspendre();
    else this.demarrer();
    return this.actif;
  }

  /** Bruit de pas sur dalle de pierre. intensite ∈ [0, 1] (marche → course). */
  pas(intensite: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.maitre || !this.bruit || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = 0.06 + intensite * 0.1;
    // Frottement de semelle : bruit filtré, attaque brève.
    const src = ctx.createBufferSource();
    src.buffer = this.bruit;
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'bandpass';
    filtre.frequency.value = 1400 + Math.random() * 900;
    filtre.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09 + intensite * 0.03);
    src.connect(filtre).connect(g).connect(this.maitre);
    src.start(t, Math.random() * 3, 0.15);
    // Impact sourd du talon.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 + Math.random() * 20, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    const go = ctx.createGain();
    go.gain.setValueAtTime(v * 0.9, t);
    go.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    o.connect(go).connect(this.maitre);
    o.start(t);
    o.stop(t + 0.08);
  }

  private creerBruit(secondes: number): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * secondes, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private boucle(gain: number, type: BiquadFilterType, frequence: number, q = 0.7): { g: GainNode; f: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.bruit;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequence;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.maitre!);
    src.start();
    return { g, f };
  }

  /** Rumeur de la ville : bruit grave modulé très lentement. */
  private rumeur(): void {
    const { g } = this.boucle(0.16, 'lowpass', 320);
    const ctx = this.ctx!;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const prof = ctx.createGain();
    prof.gain.value = 0.05;
    lfo.connect(prof).connect(g.gain);
    lfo.start();
  }

  /** Murmure de foule lointaine : bande vocale, très bas. */
  private murmure(): void {
    const { g } = this.boucle(0.018, 'bandpass', 650, 0.6);
    const ctx = this.ctx!;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const prof = ctx.createGain();
    prof.gain.value = 0.01;
    lfo.connect(prof).connect(g.gain);
    lfo.start();
  }

  /** Événements ponctuels : oiseaux et passages de véhicules. */
  private planifier(): void {
    const suivant = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') {
        if (Math.random() < 0.6) this.oiseau();
        else this.vehicule();
      }
      this.minuterie = window.setTimeout(suivant, 3000 + Math.random() * 7000);
    };
    this.minuterie = window.setTimeout(suivant, 2000);
  }

  private oiseau(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.07);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(pan).connect(this.maitre!);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  private vehicule(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const duree = 4 + Math.random() * 3;
    const src = ctx.createBufferSource();
    src.buffer = this.bruit;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(250, t);
    f.frequency.linearRampToValueAtTime(900, t + duree / 2);
    f.frequency.linearRampToValueAtTime(250, t + duree);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + duree / 2);
    g.gain.linearRampToValueAtTime(0, t + duree);
    const pan = ctx.createStereoPanner();
    const s = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.8 * s, t);
    pan.pan.linearRampToValueAtTime(0.8 * s, t + duree);
    src.connect(f).connect(g).connect(pan).connect(this.maitre!);
    src.start(t);
    src.stop(t + duree);
  }

  detruire(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    void this.ctx?.close();
    this.ctx = null;
  }
}
