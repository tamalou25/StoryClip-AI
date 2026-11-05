// Règles et réglages d'une partie : un seul endroit pour équilibrer.
// Tout est exprimé en unités lisibles (secondes, mètres, points par seconde).

export type Camp = 'manif' | 'ordre';
export type Difficulte = 'facile' | 'normal' | 'difficile';

export const CAMPS: readonly Camp[] = ['manif', 'ordre'];

export const NOM_CAMP: Record<Camp, string> = { manif: 'Manifestants', ordre: "Forces de l'ordre" };

export interface Reglages {
  /** Durée de la partie (s). */
  duree: number;
  /** Mobilisation à atteindre : points de zone cumulés (1 point par zone tenue et par seconde). */
  cibleMobilisation: number;
  effectifs: Record<Camp, number>;
  difficulte: Difficulte;
  graine: number;
}

export function reglagesParDefaut(partiel: Partial<Reglages> = {}): Reglages {
  const duree = partiel.duree ?? 300;
  return {
    duree,
    // Tenir en moyenne 0,8 zone pendant toute la partie (3 zones disponibles).
    cibleMobilisation: partiel.cibleMobilisation ?? Math.round(duree * 0.8),
    effectifs: partiel.effectifs ?? { manif: 6, ordre: 5 },
    difficulte: partiel.difficulte ?? 'normal',
    graine: partiel.graine ?? 1,
  };
}

// ——— Souffle (endurance) ———
export const SOUFFLE_MAX = 100;
/** Portée d'un contact (m, centre à centre). */
export const PORTEE_CONTACT = 1.7;
/** Perte de souffle d'un manifestant par policier au contact (points/s). */
export const CONTACT_ORDRE_SUR_MANIF = 12;
/** Multiplicateur quand le policier est en cordon (au moins un collègue à portée de cordon). */
export const BONUS_CORDON = 1.5;
/** Perte d'un policier par manifestant au contact, dès qu'ils sont au moins deux (points/s). Seul contre un, il ne perd rien. */
export const CONTACT_MANIF_SUR_ORDRE = 9;
/** Un cordon encaisse mieux. */
export const PROTECTION_CORDON = 0.65;
/** Distance entre deux policiers pour former un cordon (m). */
export const PORTEE_CORDON = 2.6;
/** Récupération (points/s) après RECUP_DELAI secondes sans perte. */
export const RECUP = 9;
export const RECUP_DELAI = 1.5;
/** Récupération bonus d'un manifestant entouré d'au moins deux camarades à 3 m. */
export const RECUP_GROUPE = 9;
export const PORTEE_GROUPE = 3;
/** Temps hors-jeu après dispersion / repli (s). */
export const RETOUR: Record<Camp, number> = { manif: 9, ordre: 11 };

// ——— Déplacement ———
export const RAYON_ACTEUR = 0.4;
export const MASSE: Record<Camp, number> = { manif: 1, ordre: 1.5 };
export const MASSE_CORDON = 4;
export const RALENTI_GAZ = 0.5;
export const ELAN_VITESSE = 1.22;

// ——— Zones ———
/** Vitesse de bascule du contrôle d'une zone, par personne d'écart et par seconde (contrôle ∈ [−1, 1]). */
export const CAPTURE_PAR_PERSONNE = 0.12;
export const CAPTURE_ECART_MAX = 3;
/** Une zone est « tenue » au-delà de ce seuil. */
export const SEUIL_TENUE = 0.5;
/** Un manifestant dans un nuage ne compte pas pour la capture. */

// ——— Spécial : gaz fictif (forces de l'ordre) ———
export const GAZ_CHARGES = 3;
export const GAZ_RECHARGE = 22; // s pour regagner une charge
export const GAZ_PORTEE = 5; // m devant le lanceur
export const GAZ_RAYON = 4.5;
export const GAZ_DUREE = 11;
export const GAZ_PERTE = 9; // points/s
export const GAZ_DELAI = 1.2; // s entre deux lancers
// ——— Spécial : slogan (manifestants) ———
export const SLOGAN_RECHARGE = 18;
export const SLOGAN_PORTEE = 9;
export const SLOGAN_SOUFFLE = 30;
export const SLOGAN_ELAN = 5; // s de vitesse accrue
// ——— Rassembler / cordon (action maintenue) ———
export const PORTEE_RALLIEMENT = 15;

export interface ProfilBots {
  /** Intervalle entre deux décisions (s). */
  reflexion: number;
  /** Probabilité d'utiliser le spécial quand c'est pertinent (par décision). */
  usageSpecial: number;
  /** Distance de perception des menaces/occasions (m). */
  perception: number;
  /** Facteur de vitesse des bots. */
  vitesse: number;
  /** Souffle sous lequel un bot se replie. */
  seuilRepli: number;
}

export const PROFILS: Record<Difficulte, ProfilBots> = {
  facile: { reflexion: 0.9, usageSpecial: 0.35, perception: 12, vitesse: 0.86, seuilRepli: 20 },
  normal: { reflexion: 0.5, usageSpecial: 0.7, perception: 18, vitesse: 0.95, seuilRepli: 32 },
  difficile: { reflexion: 0.3, usageSpecial: 0.95, perception: 26, vitesse: 1, seuilRepli: 40 },
};
