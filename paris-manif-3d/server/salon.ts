// Un salon privé : participants, phases, boucle de partie autoritaire, départs et reconnexions.
// Indépendant du transport : il parle à des `Connexion` abstraites (WebSocket en production,
// objets factices dans les tests) et avance d'un pas à chaque appel de tick() (30 Hz).
//
// Comportements :
// - Créateur (hôte) déconnecté ou parti : l'hôte passe aussitôt au plus ancien joueur connecté.
// - Déconnexion imprévue : place réservée `graceMs` ; en partie, un bot pilote le personnage en attendant.
// - Départ volontaire (ou délai de reconnexion dépassé) : en partie, le personnage reste piloté par un
//   bot jusqu'à la fin ; dans le salon ou aux résultats, la place est libérée tout de suite.
// - Partie en cours : impossible de rejoindre (code « commencee ») sauf reprise d'une place réservée.
// - Revanche : quand tous les joueurs connectés (≥ 2) ont voté, nouvelle partie avec un état neuf.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Intention } from '../src/sim/intention';
import { INTENTION_NEUTRE } from '../src/sim/intention';
import { FREQUENCE } from '../src/sim/monde';
import {
  FERMETURE,
  JOUEURS_MAX,
  JOUEURS_MIN,
  MESSAGES_ERREUR,
  NOM_MAX,
  VERSION_PROTOCOLE,
  nettoyerNom,
  type Camp,
  type CodeErreur,
  type EtatDistant,
  type MessageClient,
  type MessageServeur,
  type ParticipantVue,
  type Phase,
  type ResultatPartie,
  type VueSalon,
} from '../src/reseau/protocole';
import type { ParticipantRegles, ReglesPartie } from '../src/reseau/regles';

export interface Connexion {
  envoyer(m: MessageServeur): void;
  fermer(code: number, raison: string): void;
}

export type Journal = (evenement: string, details?: Record<string, unknown>) => void;

export interface OptionsSalon {
  regles: ReglesPartie<unknown>;
  dureePartieTicks: number;
  compteTicks: number;
  graceMs: number;
  maintenant: () => number;
  journal?: Journal;
}

/** Intentions en attente par joueur : au-delà, les plus anciennes sont abandonnées. */
const FILE_MAX = 8;
/** File visée : au-delà, l'intention la plus ancienne est écartée (client plus rapide que le serveur). */
const FILE_CIBLE = 4;
/**
 * Intention en retard (gigue) : le personnage est figé au plus FIGE_MAX ticks en l'attendant, au lieu de
 * répéter la précédente. Une intention = un pas, toujours : la prédiction du client reste exacte.
 * Au-delà (client muet), on applique l'intention neutre : le personnage s'arrête.
 */
const FIGE_MAX = 6;

export class Siege {
  pret = false;
  connexion: Connexion | null = null;
  deconnecteDepuis = 0;
  /** Parti définitivement (volontairement ou délai dépassé) : piloté par un bot jusqu'à la fin de la partie. */
  parti = false;
  file: { s: number; i: Intention }[] = [];
  derniereIntention: Intention = INTENTION_NEUTRE;
  famine = 0;
  dernierSeq = -1;
  ack = -1;
  /** Compteurs de diagnostic : intentions écartées, ticks figés en attente d'intention. */
  abandons = 0;
  figes = 0;

  constructor(readonly id: string, public nom: string, public camp: Camp, readonly jeton: string) {}
}

type ResultatEntree = { siege: Siege } | { erreur: CodeErreur };

export class Salon {
  phase: Phase = 'attente';
  partieNumero = 0;
  hote: string | null = null;
  ferme = false;
  readonly sieges = new Map<string, Siege>();
  private compteurIds = 0;
  private etatJeu: unknown = null;
  private participants: (ParticipantRegles & { nom: string })[] = [];
  private compte = 0;
  private resultat: ResultatPartie | null = null;
  private readonly journal: Journal;

  constructor(readonly code: string, private readonly options: OptionsSalon) {
    this.journal = options.journal ?? (() => {});
  }

  // ——————————————————————————————————————— Entrées / sorties

  rejoindre(nomBrut: string, campVoulu: Camp | undefined, connexion: Connexion): ResultatEntree {
    if (this.ferme) return { erreur: 'introuvable' };
    if (this.phase === 'compte' || this.phase === 'partie') return { erreur: 'commencee' };
    if (this.humains().length >= JOUEURS_MAX) return { erreur: 'complet' };
    const camp = campVoulu ?? this.campLeMoinsRempli();
    const id = `j${++this.compteurIds}`;
    const nom = this.nomUnique(nettoyerNom(nomBrut) || `Joueur ${this.compteurIds}`, null);
    const siege = new Siege(id, nom, camp, randomBytes(16).toString('hex'));
    siege.connexion = connexion;
    this.sieges.set(id, siege);
    if (!this.hote) this.hote = id;
    connexion.envoyer({ t: 'bienvenue', v: VERSION_PROTOCOLE, id, code: this.code, jeton: siege.jeton });
    this.journal('joueur_rejoint', { salon: this.code, id, joueurs: this.humains().length });
    this.diffuserSalon();
    return { siege };
  }

  reprendre(jeton: string, connexion: Connexion): ResultatEntree {
    if (this.ferme) return { erreur: 'introuvable' };
    const siege = [...this.sieges.values()].find((s) => !s.parti && egal(s.jeton, jeton));
    if (!siege) return { erreur: 'jeton' };
    const ancienne = siege.connexion;
    siege.connexion = connexion;
    if (ancienne) ancienne.fermer(FERMETURE.remplacee, 'session reprise ailleurs');
    // Nouvelle connexion : numérotation des intentions repartie de zéro côté client.
    siege.dernierSeq = -1;
    siege.ack = -1;
    siege.file = [];
    siege.famine = 0;
    if (!this.hote || !this.sieges.get(this.hote)?.connexion) this.hote = siege.id;
    connexion.envoyer({ t: 'bienvenue', v: VERSION_PROTOCOLE, id: siege.id, code: this.code, jeton: siege.jeton });
    this.journal('reprise', { salon: this.code, id: siege.id });
    this.diffuserSalon();
    if (this.phase === 'compte' || this.phase === 'partie') {
      connexion.envoyer(this.messageDebut());
      this.envoyerEtat(siege);
    } else if (this.phase === 'resultats' && this.resultat) {
      connexion.envoyer({ t: 'fin', resultat: this.resultat });
    }
    return { siege };
  }

  /** La socket de ce siège s'est fermée sans « quitter » (réseau, onglet fermé…). */
  deconnexion(siege: Siege, connexion: Connexion): void {
    if (siege.connexion !== connexion || this.sieges.get(siege.id) !== siege) return;
    siege.connexion = null;
    siege.deconnecteDepuis = this.options.maintenant();
    siege.file = [];
    this.journal('deconnexion', { salon: this.code, id: siege.id, phase: this.phase });
    if (this.hote === siege.id) this.transfererHote();
    this.diffuserSalon();
    this.verifierRevanche();
  }

  /** Départ volontaire : la connexion est fermée et la place libérée. */
  quitter(siege: Siege): void {
    if (this.sieges.get(siege.id) !== siege) return;
    const c = siege.connexion;
    siege.connexion = null;
    c?.fermer(FERMETURE.quitte, 'salon quitté');
    this.partir(siege, 'depart');
  }

  message(siege: Siege, m: MessageClient): void {
    if (this.sieges.get(siege.id) !== siege || this.ferme) return;
    const c = siege.connexion;
    switch (m.t) {
      case 'i':
        this.recevoirIntention(siege, m.s, { dx: m.dx, dz: m.dz, action: m.a });
        return;
      case 'ping':
        c?.envoyer({ t: 'pong', c: m.c, k: this.tickCourant() });
        return;
      case 'profil':
        if (this.phase !== 'attente' && this.phase !== 'resultats') {
          this.erreur(siege, 'conditions', 'Le nom et le camp ne changent pas pendant une partie.');
          return;
        }
        if (m.nom !== undefined) {
          const nom = nettoyerNom(m.nom);
          if (nom) siege.nom = this.nomUnique(nom, siege);
        }
        if (m.camp !== undefined && m.camp !== siege.camp) {
          siege.camp = m.camp;
          siege.pret = false;
        }
        this.diffuserSalon();
        return;
      case 'pret':
        if (this.phase !== 'attente' && this.phase !== 'resultats') return;
        siege.pret = m.pret;
        this.diffuserSalon();
        this.verifierRevanche();
        return;
      case 'demarrer': {
        if (this.phase !== 'attente') {
          this.erreur(siege, 'conditions', 'La partie est déjà lancée.');
          return;
        }
        if (siege.id !== this.hote) {
          this.erreur(siege, 'non_hote');
          return;
        }
        const raison = this.conditions();
        if (raison) {
          this.erreur(siege, 'conditions', raison);
          return;
        }
        this.demarrerCompte();
        return;
      }
      default:
        return; // creer / rejoindre / reprendre / quitter sont traités par le serveur
    }
  }

  // ——————————————————————————————————————— Pas de temps

  tick(): void {
    if (this.ferme) return;
    const maintenant = this.options.maintenant();
    for (const s of [...this.sieges.values()]) {
      if (!s.parti && !s.connexion && maintenant - s.deconnecteDepuis > this.options.graceMs) {
        this.journal('delai_depasse', { salon: this.code, id: s.id });
        this.partir(s, 'delai');
      }
    }

    if (this.phase === 'compte') {
      this.compte--;
      if (this.compte <= 0) {
        this.phase = 'partie';
        this.diffuserSalon();
        this.diffuserEtats();
      } else if (this.compte % FREQUENCE === 0) {
        this.diffuserSalon();
        this.diffuserEtats();
      }
    } else if (this.phase === 'partie' && this.etatJeu !== null) {
      const regles = this.options.regles;
      const intentions: Record<string, Intention> = {};
      const figes = new Set<string>();
      for (const p of this.participants) {
        const s = this.sieges.get(p.id);
        if (s && s.connexion && !s.parti) {
          const i = this.prendreIntention(s);
          if (i) intentions[p.id] = i;
          else figes.add(p.id);
        } else {
          intentions[p.id] = regles.intentionBot(this.etatJeu, p.id);
        }
      }
      this.etatJeu = regles.etape(this.etatJeu, intentions, figes);
      this.diffuserEtats();
      const fin = regles.resultat(this.etatJeu);
      if (fin) this.terminer(fin);
    }
  }

  /** Plus personne ne peut revenir : le serveur peut supprimer le salon. */
  vide(): boolean {
    return this.ferme || ![...this.sieges.values()].some((s) => !s.parti);
  }

  fermer(code: number, raison: string): void {
    if (this.ferme) return;
    this.ferme = true;
    for (const s of this.sieges.values()) {
      const c = s.connexion;
      s.connexion = null;
      if (c && code === FERMETURE.interne) c.envoyer({ t: 'erreur', code: 'interne', message: MESSAGES_ERREUR.interne, fatal: true });
      c?.fermer(code, raison);
    }
    this.journal('salon_ferme', { salon: this.code, raison });
  }

  vue(): VueSalon {
    const joueurs = [...this.sieges.values()].map((s) => ({
      id: s.id,
      nom: s.nom,
      camp: s.camp,
      pret: s.pret,
      presence: s.parti ? ('parti' as const) : s.connexion ? ('connecte' as const) : ('reconnexion' as const),
      hote: s.id === this.hote,
    }));
    return {
      code: this.code,
      phase: this.phase,
      partie: this.partieNumero,
      joueurs,
      compte: this.phase === 'compte' ? Math.ceil(this.compte / FREQUENCE) : 0,
      attente: this.phase === 'attente' || this.phase === 'resultats' ? this.conditions() : null,
      dureePartie: Math.round(this.options.dureePartieTicks / FREQUENCE),
    };
  }

  // ——————————————————————————————————————— Interne

  private humains(): Siege[] {
    return [...this.sieges.values()].filter((s) => !s.parti);
  }

  private connectes(): Siege[] {
    return this.humains().filter((s) => s.connexion !== null);
  }

  private tickCourant(): number {
    return this.etatJeu !== null ? this.options.regles.vue(this.etatJeu).tick : 0;
  }

  private campLeMoinsRempli(): Camp {
    const h = this.humains();
    const m = h.filter((s) => s.camp === 'manifestants').length;
    return h.length - m < m ? 'forces' : 'manifestants';
  }

  private nomUnique(base: string, soi: Siege | null): string {
    const pris = (n: string) => [...this.sieges.values()].some((s) => s !== soi && !s.parti && s.nom.toLocaleLowerCase('fr') === n.toLocaleLowerCase('fr'));
    if (!pris(base)) return base;
    for (let i = 2; i < 10; i++) {
      const suffixe = ` ${i}`;
      const n = Array.from(base).slice(0, NOM_MAX - suffixe.length).join('') + suffixe;
      if (!pris(n)) return n;
    }
    return base;
  }

  private transfererHote(): void {
    const suivant = this.connectes()[0] ?? null; // ordre d'arrivée (Map conserve l'ordre d'insertion)
    this.hote = suivant?.id ?? null;
    if (suivant) this.journal('hote_transfere', { salon: this.code, id: suivant.id });
  }

  private partir(siege: Siege, raison: 'depart' | 'delai'): void {
    const enJeu = (this.phase === 'compte' || this.phase === 'partie') && this.participants.some((p) => p.id === siege.id);
    if (enJeu) {
      siege.parti = true; // le personnage reste, piloté par un bot jusqu'à la fin
      siege.file = [];
    } else {
      this.sieges.delete(siege.id);
    }
    this.journal(raison === 'depart' ? 'depart' : 'place_liberee', { salon: this.code, id: siege.id, phase: this.phase });
    if (this.hote === siege.id || (this.hote && !this.sieges.get(this.hote)?.connexion)) this.transfererHote();
    this.diffuserSalon();
    this.verifierRevanche();
  }

  /** Raison qui empêche de lancer (salon) ou la revanche (résultats), null si tout est réuni. */
  private conditions(): string | null {
    const connectes = this.connectes();
    if (connectes.length < JOUEURS_MIN) return 'En attente d’au moins 2 joueurs connectés.';
    const nonPrets = connectes.filter((s) => !s.pret).length;
    if (nonPrets > 0) {
      return this.phase === 'resultats'
        ? `Revanche : ${nonPrets} vote${nonPrets > 1 ? 's' : ''} manquant${nonPrets > 1 ? 's' : ''}.`
        : `En attente : ${nonPrets} joueur${nonPrets > 1 ? 's' : ''} pas encore prêt${nonPrets > 1 ? 's' : ''}.`;
    }
    return null;
  }

  private verifierRevanche(): void {
    if (this.phase === 'resultats' && !this.ferme && this.conditions() === null) this.demarrerCompte();
  }

  private demarrerCompte(): void {
    this.partieNumero++;
    const humains = this.humains();
    const participants: (ParticipantRegles & { nom: string })[] = humains.map((s) => ({ id: s.id, camp: s.camp, bot: false, nom: s.nom }));
    // Équipes complétées par des bots serveur jusqu'à égalité d'effectif.
    const effectif = (c: Camp) => humains.filter((s) => s.camp === c).length;
    const n = Math.max(effectif('manifestants'), effectif('forces'));
    let b = 0;
    for (const camp of ['manifestants', 'forces'] as const) {
      for (let k = effectif(camp); k < n; k++) participants.push({ id: `b${++b}`, camp, bot: true, nom: `Bot ${b}` });
    }
    this.participants = participants;
    this.etatJeu = this.options.regles.creer(participants, this.options.dureePartieTicks);
    this.resultat = null;
    this.compte = this.options.compteTicks;
    this.phase = this.compte > 0 ? 'compte' : 'partie';
    for (const s of this.sieges.values()) {
      s.pret = false;
      s.file = [];
      s.famine = 0;
      s.derniereIntention = INTENTION_NEUTRE;
      s.ack = s.dernierSeq; // les intentions antérieures ne seront jamais appliquées
    }
    this.journal('debut', { salon: this.code, partie: this.partieNumero, humains: humains.length, bots: b });
    const debut = this.messageDebut();
    for (const s of this.sieges.values()) s.connexion?.envoyer(debut);
    this.diffuserSalon();
    this.diffuserEtats();
  }

  private terminer(fin: { gagnant: Camp | 'egalite'; scores: Record<Camp, number>; points: Record<string, number> }): void {
    const resultat: ResultatPartie = {
      partie: this.partieNumero,
      gagnant: fin.gagnant,
      scores: fin.scores,
      participants: this.participants.map((p) => ({
        id: p.id,
        nom: p.nom,
        camp: p.camp,
        bot: p.bot || (this.sieges.get(p.id)?.parti ?? true),
        points: fin.points[p.id] ?? 0,
      })),
    };
    this.resultat = resultat;
    this.phase = 'resultats';
    this.etatJeu = null;
    this.participants = [];
    for (const s of [...this.sieges.values()]) {
      if (s.parti) this.sieges.delete(s.id);
      s.pret = false;
      s.file = [];
    }
    this.journal('fin', { salon: this.code, partie: resultat.partie, gagnant: resultat.gagnant });
    for (const s of this.sieges.values()) s.connexion?.envoyer({ t: 'fin', resultat });
    this.diffuserSalon();
  }

  private recevoirIntention(siege: Siege, s: number, i: Intention): void {
    if (s <= siege.dernierSeq) return; // doublon ou rejeu : ignoré
    siege.dernierSeq = s;
    if (this.phase === 'compte') {
      siege.ack = s; // pas encore de mouvement : intention consommée sans effet
      return;
    }
    if (this.phase !== 'partie' || siege.parti) return;
    siege.file.push({ s, i });
    if (siege.file.length > FILE_MAX) {
      siege.file.shift();
      siege.abandons++;
    }
  }

  /** Intention à appliquer ce tick, ou null pour figer le personnage (intention attendue). */
  private prendreIntention(siege: Siege): Intention | null {
    if (siege.file.length > FILE_CIBLE) {
      const ecartee = siege.file.shift()!;
      siege.ack = ecartee.s;
      siege.abandons++;
    }
    const e = siege.file.shift();
    if (e) {
      siege.derniereIntention = e.i;
      siege.ack = e.s;
      siege.famine = 0;
      return e.i;
    }
    siege.famine++;
    if (siege.famine <= FIGE_MAX) {
      siege.figes++;
      return null;
    }
    return INTENTION_NEUTRE;
  }

  private messageDebut(): MessageServeur {
    const participants: ParticipantVue[] = this.participants.map((p) => ({ id: p.id, nom: p.nom, camp: p.camp, bot: p.bot }));
    return {
      t: 'debut',
      partie: this.partieNumero,
      duree: this.options.dureePartieTicks,
      participants,
      objectifs: [...this.options.regles.objectifs],
    };
  }

  private diffuserSalon(): void {
    if (this.ferme) return;
    const salon = this.vue();
    for (const s of this.sieges.values()) s.connexion?.envoyer({ t: 'salon', salon });
  }

  private distants(): Record<string, EtatDistant> {
    const vue = this.options.regles.vue(this.etatJeu);
    const j: Record<string, EtatDistant> = {};
    for (const [id, p] of Object.entries(vue.personnages)) {
      j[id] = [arrondi(p.x, 100), arrondi(p.z, 100), arrondi(p.cap, 100), arrondi(Math.hypot(p.vx, p.vz), 10), vue.actions[id] ? 1 : 0];
    }
    return j;
  }

  private diffuserEtats(): void {
    if (this.etatJeu === null) return;
    const j = this.distants();
    for (const s of this.sieges.values()) if (s.connexion && !s.parti) this.envoyerEtat(s, j);
  }

  private envoyerEtat(siege: Siege, tous?: Record<string, EtatDistant>): void {
    if (this.etatJeu === null || !siege.connexion) return;
    const vue = this.options.regles.vue(this.etatJeu);
    const j = { ...(tous ?? this.distants()) };
    delete j[siege.id];
    const p = vue.personnages[siege.id];
    siege.connexion.envoyer({
      t: 'etat',
      k: vue.tick,
      a: siege.ack,
      m: p ? [p.x, p.z, p.vx, p.vz, p.cap] : null,
      j,
      s: [vue.scores.manifestants, vue.scores.forces],
      z: [...vue.objectifs],
      r: vue.restant,
    });
  }

  private erreur(siege: Siege, code: CodeErreur, message = MESSAGES_ERREUR[code]): void {
    siege.connexion?.envoyer({ t: 'erreur', code, message, fatal: false });
  }
}

function arrondi(v: number, facteur: number): number {
  return Math.round(v * facteur) / facteur;
}

/** Comparaison à durée constante des jetons de reconnexion. */
function egal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
