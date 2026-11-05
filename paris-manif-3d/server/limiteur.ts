// Limiteurs de fréquence : seau à jetons (par connexion) et fenêtre glissante (par adresse IP).

export type Horloge = () => number; // millisecondes

/** Seau à jetons : `capacite` messages d'affilée, puis `parSeconde` en continu. */
export class SeauJetons {
  private jetons: number;
  private dernier: number;

  constructor(private readonly capacite: number, private readonly parSeconde: number, private readonly maintenant: Horloge) {
    this.jetons = capacite;
    this.dernier = maintenant();
  }

  prendre(n = 1): boolean {
    const t = this.maintenant();
    this.jetons = Math.min(this.capacite, this.jetons + ((t - this.dernier) / 1000) * this.parSeconde);
    this.dernier = t;
    if (this.jetons < n) return false;
    this.jetons -= n;
    return true;
  }
}

/** Au plus `max` événements par clé sur `fenetreMs` (ex. créations de salon par IP et par minute). */
export class FenetreGlissante {
  private readonly evenements = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly fenetreMs: number, private readonly maintenant: Horloge) {}

  autoriser(cle: string): boolean {
    const t = this.maintenant();
    const liste = (this.evenements.get(cle) ?? []).filter((x) => t - x < this.fenetreMs);
    if (liste.length >= this.max) {
      this.evenements.set(cle, liste);
      return false;
    }
    liste.push(t);
    this.evenements.set(cle, liste);
    return true;
  }

  /** Purge des clés inactives (appelée périodiquement). */
  nettoyer(): void {
    const t = this.maintenant();
    for (const [cle, liste] of this.evenements) {
      if (liste.every((x) => t - x >= this.fenetreMs)) this.evenements.delete(cle);
    }
  }
}
