// Interpolation des personnages distants et estimation de l'horloge serveur.
// Les distants sont affichés légèrement dans le passé (≈ 1 tick + marge de gigue) entre deux
// instantanés reçus : mouvement fluide même si les paquets arrivent irrégulièrement.

import { FREQUENCE } from '../sim/monde';
import { normaliserAngle } from '../sim/math';

export interface EchantillonDistant {
  x: number;
  z: number;
  cap: number;
  vitesse: number;
  action: boolean;
}

const CONSERVES = 90; // 3 s d'historique
const EXTRAPOLATION_MAX = 3; // ticks (100 ms) au-delà du dernier instantané, puis on fige

export class TamponInterpolation {
  private instantanes: { tick: number; entites: Map<string, EchantillonDistant> }[] = [];

  ajouter(tick: number, entites: Map<string, EchantillonDistant>): void {
    const dernier = this.instantanes[this.instantanes.length - 1];
    if (dernier && tick <= dernier.tick) return; // doublon ou désordre : ignoré
    this.instantanes.push({ tick, entites });
    if (this.instantanes.length > CONSERVES) this.instantanes.shift();
  }

  get dernierTick(): number {
    return this.instantanes[this.instantanes.length - 1]?.tick ?? -1;
  }

  vider(): void {
    this.instantanes = [];
  }

  /** Échantillonne tous les personnages au tick (fractionnaire) demandé. */
  echantillonner(tick: number): Map<string, EchantillonDistant> {
    const res = new Map<string, EchantillonDistant>();
    const n = this.instantanes.length;
    if (n === 0) return res;
    const premier = this.instantanes[0]!;
    const dernier = this.instantanes[n - 1]!;
    if (tick <= premier.tick || n === 1) {
      for (const [id, e] of (tick <= premier.tick ? premier : dernier).entites) res.set(id, { ...e });
      return res;
    }
    if (tick >= dernier.tick) {
      // Extrapolation courte à partir des deux derniers instantanés, puis arrêt.
      const avant = this.instantanes[n - 2]!;
      const pas = Math.min(tick - dernier.tick, EXTRAPOLATION_MAX);
      const span = dernier.tick - avant.tick;
      for (const [id, b] of dernier.entites) {
        const a = avant.entites.get(id);
        if (!a || span <= 0) { res.set(id, { ...b }); continue; }
        res.set(id, { ...b, x: b.x + ((b.x - a.x) / span) * pas, z: b.z + ((b.z - a.z) / span) * pas });
      }
      return res;
    }
    // Recherche de l'intervalle [a, b] qui contient tick (les instantanés sont triés).
    let i = n - 2;
    while (i > 0 && this.instantanes[i]!.tick > tick) i--;
    const A = this.instantanes[i]!;
    const B = this.instantanes[i + 1]!;
    const t = (tick - A.tick) / (B.tick - A.tick);
    for (const [id, b] of B.entites) {
      const a = A.entites.get(id);
      if (!a) { res.set(id, { ...b }); continue; }
      res.set(id, interpoler(a, b, t));
    }
    for (const [id, a] of A.entites) if (!res.has(id)) res.set(id, { ...a });
    return res;
  }
}

export function interpoler(a: EchantillonDistant, b: EchantillonDistant, t: number): EchantillonDistant {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    cap: normaliserAngle(a.cap + normaliserAngle(b.cap - a.cap) * t),
    vitesse: a.vitesse + (b.vitesse - a.vitesse) * t,
    action: t < 0.5 ? a.action : b.action,
  };
}

/**
 * Estime le tick serveur courant à partir des instantanés reçus (horloge locale en ms).
 * - `avance` suit l'enveloppe des paquets les plus rapides (monte tout de suite, redescend lentement) ;
 * - `gigue` = moyenne glissante du retard des autres paquets par rapport à cette enveloppe.
 * Le tick de rendu des distants = tick estimé − (1 tick + 2 × gigue), borné à [1, 10] ticks.
 */
export class HorlogeServeur {
  private avance: number | null = null;
  private gigueTicks = 0;
  private derniereObservation = 0;

  observer(tickServeur: number, maintenantMs: number): void {
    const local = (maintenantMs / 1000) * FREQUENCE;
    const echantillon = tickServeur - local;
    if (this.avance === null || Math.abs(echantillon - this.avance) > 2 * FREQUENCE) {
      this.avance = echantillon; // premier paquet ou saut (pause, reconnexion) : on recale
      this.gigueTicks = 0.5;
    } else {
      // Descente lente (0,5 tick/s) pour suivre un retard qui augmente.
      const ecoule = Math.max(0, maintenantMs - this.derniereObservation) / 1000;
      this.avance -= 0.5 * ecoule;
      if (echantillon > this.avance) this.avance = echantillon;
      this.gigueTicks += ((this.avance - echantillon) - this.gigueTicks) * 0.05;
    }
    this.derniereObservation = maintenantMs;
  }

  get pret(): boolean {
    return this.avance !== null;
  }

  /** Tick serveur estimé « maintenant » (fractionnaire). */
  tickEstime(maintenantMs: number): number {
    return (maintenantMs / 1000) * FREQUENCE + (this.avance ?? 0);
  }

  /** Retard d'affichage des distants, en ticks. */
  get retardRendu(): number {
    return Math.min(10, Math.max(1, 1 + 2 * this.gigueTicks));
  }

  tickRendu(maintenantMs: number): number {
    return this.tickEstime(maintenantMs) - this.retardRendu;
  }

  reinitialiser(): void {
    this.avance = null;
    this.gigueTicks = 0;
  }
}
