// Types de l'état d'une partie : acteurs (joueur et bots), zones, nuages, journal.
// Interface client ↔ simulation : le client ne lit que ces structures et les événements.

import type { Personnage } from './deplacement';
import type { Camp, Reglages } from './regles';

export type EtatActeur = 'actif' | 'hors-jeu';

export interface Acteur extends Personnage {
  id: string;
  camp: Camp;
  bot: boolean;
  /** Pseudonyme affiché (texte non fiable : toujours via textContent). */
  nom: string;
  etat: EtatActeur;
  /** Temps restant hors-jeu (s). */
  retour: number;
  souffle: number;
  /** Secondes écoulées depuis la dernière perte de souffle. */
  depuisPerte: number;
  /** Vrai si l'acteur maintient l'action (rassembler / cordon) ce pas. */
  rallie: boolean;
  /** Temps d'élan restant (s, vitesse accrue). */
  elan: number;
  /** Temps avant le prochain spécial (s). */
  recharge: number;
  /** Charges de gaz (forces de l'ordre) ; ignoré côté manifestants. */
  charges: number;
  /** Progression de la recharge d'une charge (s). */
  rechargeCharge: number;
  /** Vrai si dans un nuage ce pas (ralenti, ne capture pas). */
  dansGaz: boolean;
  /** Vrai si en cordon ce pas (forces de l'ordre : un collègue à portée). */
  enCordon: boolean;
  /** Vrai si au contact d'un adversaire ce pas (lisibilité HUD). */
  auContact: boolean;
  /** Dernier spécial pressé (pour le front montant). */
  specialPrecedent: boolean;
  stats: StatsActeur;
}

export interface StatsActeur {
  dispersions: number;
  /** Adversaires mis hors-jeu avec sa participation. */
  neutralisations: number;
  speciaux: number;
  /** Secondes passées dans une zone. */
  tempsEnZone: number;
}

export interface Zone {
  id: string;
  nom: string;
  x: number;
  z: number;
  rayon: number;
  /** −1 = forces de l'ordre, +1 = manifestants. */
  controle: number;
  tenue: Camp | null;
  /** Effectifs comptés ce pas (lisibilité HUD). */
  presents: Record<Camp, number>;
}

export interface Nuage {
  id: string;
  x: number;
  z: number;
  rayon: number;
  /** Temps restant (s). */
  reste: number;
  duree: number;
  auteur: string;
}

export type Phase = 'en-cours' | 'terminee';

export interface EntreeJournal {
  temps: number;
  texte: string;
}

export interface Partie {
  phase: Phase;
  temps: number;
  duree: number;
  mobilisation: number;
  cibleMobilisation: number;
  vainqueur: Camp | null;
  raison: string | null;
  /** Secondes de zone tenue par camp (cumul). */
  tenueCumulee: Record<Camp, number>;
  journal: EntreeJournal[];
  reglages: Reglages;
  /** Camp du joueur humain (null : partie entre bots). La difficulté s'applique aux bots adverses. */
  campJoueur: Camp | null;
}

export type Evenement =
  | { type: 'zone'; zone: string; nom: string; camp: Camp | null; x: number; z: number }
  | { type: 'disperse'; id: string; camp: Camp; x: number; z: number; cause: 'contact' | 'gaz' | 'nombre' }
  | { type: 'retour'; id: string; camp: Camp }
  | { type: 'gaz'; id: string; x: number; z: number }
  | { type: 'slogan'; id: string; x: number; z: number }
  | { type: 'fin'; vainqueur: Camp; raison: string }
  | { type: 'alerte'; texte: string };
