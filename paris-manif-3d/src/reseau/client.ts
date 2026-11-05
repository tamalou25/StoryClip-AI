// Client réseau du jeu : connexion, salon, envoi des intentions à pas fixe, prédiction locale,
// interpolation des distants, reconnexion automatique. Aucune dépendance au DOM ni à Node :
// le navigateur l'utilise avec WebSocket natif, les tests Node avec le WebSocket global de Node 22.

import type { Personnage } from '../sim/deplacement';
import { normaliserIntention, type Intention } from '../sim/intention';
import { DT } from '../sim/monde';
import { HorlogeServeur, TamponInterpolation, type EchantillonDistant } from './interpolation';
import { Predicteur, type StatsCorrections } from './prediction';
import {
  FERMETURE,
  MESSAGES_ERREUR,
  VERSION_PROTOCOLE,
  type Camp,
  type CodeErreur,
  type MessageClient,
  type MessageEtat,
  type MessageServeur,
  type ObjectifVue,
  type ParticipantVue,
  type ResultatPartie,
  type VueSalon,
} from './protocole';
import type { ReglesPartie } from './regles';

/** Sous-ensemble commun au WebSocket du navigateur et à celui de Node 22. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const OUVERT = 1;
const PAS_MAX_PAR_APPEL = 8;
const PERIODE_PING = 2000;
const SILENCE_MAX = 6000; // ms sans aucun message → connexion considérée comme interrompue
const RECONNEXION_MAX_DEFAUT = 30000;
const DELAI_OUVERTURE = 8000; // ms pour établir la connexion

export type EtatConnexion = 'hors_ligne' | 'connexion' | 'en_ligne' | 'reconnexion';
export type CodeErreurClient = CodeErreur | 'indisponible' | 'interrompue' | 'perdue' | 'remplacee' | 'expulse' | 'ferme';

export const MESSAGES_CLIENT: Readonly<Record<CodeErreurClient, string>> = {
  ...MESSAGES_ERREUR,
  indisponible: 'Serveur indisponible. Vérifiez votre connexion ou réessayez plus tard.',
  interrompue: 'Connexion interrompue : reconnexion en cours…',
  perdue: 'Connexion perdue : impossible de rejoindre le salon à temps.',
  remplacee: 'Cette partie a été reprise dans un autre onglet ou appareil.',
  expulse: 'Connexion fermée par le serveur (messages invalides ou trop nombreux).',
  ferme: 'Le salon a été fermé.',
};

export interface Session {
  code: string;
  jeton: string;
  id: string;
}

export interface InfoPartie {
  partie: number;
  duree: number;
  participants: ParticipantVue[];
  objectifs: ObjectifVue[];
}

export interface EvenementsClient {
  connexion?(etat: EtatConnexion): void;
  salon?(vue: VueSalon): void;
  debut?(info: InfoPartie): void;
  etat?(m: MessageEtat): void;
  fin?(r: ResultatPartie): void;
  erreur?(code: CodeErreurClient, message: string, fatal: boolean): void;
}

export interface OptionsClient {
  url: string;
  regles: Pick<ReglesPartie<unknown>, 'deplacer'>;
  fabrique?: (url: string) => SocketLike;
  /** Latence simulée dans chaque sens (ms) et gigue maximale (ms) : tests et ?latence= seulement. */
  latenceMs?: number;
  gigueMs?: number;
  /** Prédiction locale + réconciliation (défaut : activée). */
  prediction?: boolean;
  maintenant?: () => number;
  /** Persistance de la session (sessionStorage dans le navigateur) pour reprendre après rechargement. */
  stockage?: { lire(): Session | null; ecrire(s: Session | null): void };
  reconnexionMaxMs?: number;
  aleatoire?: () => number;
}

export interface PoseLocale {
  x: number;
  z: number;
  cap: number;
  vitesse: number;
}

export class ClientReseau {
  readonly evenements: EvenementsClient = {};
  etatConnexion: EtatConnexion = 'hors_ligne';
  session: Session | null = null;
  salon: VueSalon | null = null;
  partie: InfoPartie | null = null;
  dernierEtat: MessageEtat | null = null;
  resultat: ResultatPartie | null = null;
  /** Aller-retour mesuré (ms, moyenne glissante), latence simulée comprise. */
  rtt = 0;
  readonly stats = { envoyes: 0, recus: 0, octetsEnvoyes: 0, octetsRecus: 0, intentions: 0 };

  private socket: SocketLike | null = null;
  private fileOuverture: string[] = [];
  private aEteOuverte = false;
  private seq = 0;
  private accumulateur = 0;
  private derniereIntention: Intention = { dx: 0, dz: 0, action: false };
  private readonly predicteur: Predicteur;
  private readonly tampon = new TamponInterpolation();
  private readonly horloge = new HorlogeServeur();
  /** Sans prédiction : deux derniers états serveur du joueur local et heure d'arrivée. */
  private serveurLocal: { a: Personnage; b: Personnage; recu: number } | null = null;
  private minuteurs: ReturnType<typeof setInterval>[] = [];
  private minuteurOuverture: ReturnType<typeof setTimeout> | null = null;
  private reconnexion: { debut: number; essais: number; minuteur: ReturnType<typeof setTimeout> | null } | null = null;
  private dernierMessage = 0;
  /** Latence simulée (tests, ?latence=) : files FIFO, l'ordre est conservé comme avec TCP. */
  private readonly fileEnvoi: FileRetardee | null;
  private readonly fileReception: FileRetardee | null;
  private readonly maintenant: () => number;
  private readonly aleatoire: () => number;
  private readonly fabrique: (url: string) => SocketLike;

  constructor(private readonly options: OptionsClient) {
    this.maintenant = options.maintenant ?? (() => performance.now());
    this.aleatoire = options.aleatoire ?? Math.random;
    this.fabrique = options.fabrique ?? ((url) => new (globalThis as unknown as { WebSocket: new (u: string) => SocketLike }).WebSocket(url));
    this.predicteur = new Predicteur(options.regles.deplacer);
    const latence = options.latenceMs ?? 0;
    const gigue = options.gigueMs ?? 0;
    const simulee = latence > 0 || gigue > 0;
    this.fileEnvoi = simulee ? new FileRetardee(latence, gigue, this.maintenant, this.aleatoire) : null;
    this.fileReception = simulee ? new FileRetardee(latence, gigue, this.maintenant, this.aleatoire) : null;
    this.session = options.stockage?.lire() ?? null;
  }

  get id(): string | null {
    return this.session?.id ?? null;
  }

  get prediction(): boolean {
    return this.options.prediction !== false;
  }

  get statsCorrections(): StatsCorrections {
    return this.predicteur.stats;
  }

  /** État prédit au dernier pas (sans lissage visuel) : doit égaler l'état serveur une fois tout confirmé. */
  get etatPredit(): Personnage | null {
    return this.predicteur.etat;
  }

  get retardInterpolationMs(): number {
    return (this.horloge.retardRendu * DT) * 1000;
  }

  // ——————————————————————————————————————— Commandes du salon

  creer(nom: string, camp: Camp): void {
    this.ouvrir({ t: 'creer', v: VERSION_PROTOCOLE, nom, camp });
  }

  rejoindre(code: string, nom: string, camp?: Camp): void {
    const m: MessageClient = camp ? { t: 'rejoindre', v: VERSION_PROTOCOLE, code, nom, camp } : { t: 'rejoindre', v: VERSION_PROTOCOLE, code, nom };
    this.ouvrir(m);
  }

  /** Reprend la session mémorisée (après rechargement de la page). Renvoie false s'il n'y en a pas. */
  reprendre(): boolean {
    if (!this.session) return false;
    // Traitée comme une reconnexion : si le serveur ne répond pas tout de suite, on réessaie
    // tant que la place peut être réservée, au lieu d'afficher « serveur indisponible ».
    this.arreterReconnexion();
    this.reconnexion = { debut: this.maintenant(), essais: 0, minuteur: null };
    this.connecter([JSON.stringify({ t: 'reprendre', v: VERSION_PROTOCOLE, code: this.session.code, jeton: this.session.jeton })], true);
    return true;
  }

  profil(changement: { nom?: string; camp?: Camp }): void {
    this.envoyer({ t: 'profil', ...changement });
  }

  pret(pret: boolean): void {
    this.envoyer({ t: 'pret', pret });
  }

  demarrer(): void {
    this.envoyer({ t: 'demarrer' });
  }

  /** Quitte le salon volontairement : la place est libérée (remplacée par un bot en cours de partie). */
  quitter(): void {
    this.envoyer({ t: 'quitter' });
    this.oublierSession();
    // Laisse partir le message (latence simulée comprise) avant de fermer.
    const delai = (this.fileEnvoi?.attenteMs() ?? 0) + 50;
    setTimeout(() => this.fermer(), delai);
  }

  /** Ferme la connexion sans quitter le salon (la place reste réservée le temps de la reconnexion). */
  fermer(): void {
    this.arreterReconnexion();
    const s = this.socket;
    this.detacher();
    if (s && s.readyState <= OUVERT) s.close(1000, 'fermeture');
    this.changerEtat('hors_ligne');
    this.salon = null;
  }

  // ——————————————————————————————————————— Boucle de jeu

  /**
   * À appeler à chaque image avec la durée écoulée (s) et l'intention courante.
   * Envoie une intention par pas fixe (30 Hz) et l'applique aussitôt en local (prédiction).
   */
  avancer(dt: number, intention: Intention): void {
    if (this.salon?.phase !== 'partie' || this.etatConnexion !== 'en_ligne' || !this.partie) {
      this.accumulateur = 0;
      return;
    }
    intention = normaliserIntention(intention);
    this.derniereIntention = intention;
    this.accumulateur += Math.min(dt, 0.25);
    let pas = 0;
    while (this.accumulateur >= DT && pas < PAS_MAX_PAR_APPEL) {
      this.seq++;
      this.envoyer({ t: 'i', s: this.seq, dx: intention.dx, dz: intention.dz, a: intention.action });
      this.stats.intentions++;
      if (this.prediction) this.predicteur.appliquer(this.seq, intention);
      this.accumulateur -= DT;
      pas++;
    }
    if (pas === PAS_MAX_PAR_APPEL) this.accumulateur = 0;
  }

  /** Pose à afficher pour le joueur local (prédite, ou dernier état serveur sans prédiction). */
  poseLocale(dtImage: number): PoseLocale | null {
    if (this.prediction) {
      const p = this.predicteur.pose(Math.min(1, this.accumulateur / DT), dtImage);
      return p ? { x: p.x, z: p.z, cap: p.cap, vitesse: Math.hypot(p.vx, p.vz) } : null;
    }
    const s = this.serveurLocal;
    if (!s) return null;
    const t = Math.min(1, (this.maintenant() - s.recu) / (DT * 1000));
    const vx = s.a.vx + (s.b.vx - s.a.vx) * t;
    const vz = s.a.vz + (s.b.vz - s.a.vz) * t;
    let dcap = s.b.cap - s.a.cap;
    if (dcap > Math.PI) dcap -= Math.PI * 2;
    else if (dcap < -Math.PI) dcap += Math.PI * 2;
    return { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t, cap: s.a.cap + dcap * t, vitesse: Math.hypot(vx, vz) };
  }

  /** Personnages distants interpolés à l'instant de rendu. */
  posesDistantes(): Map<string, EchantillonDistant> {
    if (!this.horloge.pret) return new Map();
    return this.tampon.echantillonner(this.horloge.tickRendu(this.maintenant()));
  }

  get actionLocale(): boolean {
    return this.derniereIntention.action;
  }

  // ——————————————————————————————————————— Transport

  private ouvrir(premier: MessageClient): void {
    if (this.socket && this.socket.readyState === OUVERT) {
      this.envoyer(premier);
      return;
    }
    this.arreterReconnexion();
    this.connecter([JSON.stringify(premier)], false);
  }

  private connecter(file: string[], reprise: boolean): void {
    this.detacher();
    this.fileOuverture = file;
    this.aEteOuverte = false;
    this.changerEtat(reprise ? 'reconnexion' : 'connexion');
    let s: SocketLike;
    try {
      s = this.fabrique(this.options.url);
    } catch {
      this.surFermeture(1006, reprise);
      return;
    }
    this.socket = s;
    s.onopen = () => {
      if (this.socket !== s) return;
      this.aEteOuverte = true;
      this.dernierMessage = this.maintenant();
      const file = this.fileOuverture;
      this.fileOuverture = [];
      for (const t of file) this.envoyerTexte(t);
      this.demarrerMinuteurs();
      if (!reprise) this.changerEtat('en_ligne');
    };
    s.onmessage = (ev) => {
      if (this.socket !== s) return;
      const texte = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.recevoirAvecLatence(() => { if (this.socket === s) this.recevoir(texte); });
    };
    // Certaines piles (Node 22, navigateurs mobiles) signalent un échec d'ouverture par `error` sans
    // jamais émettre `close`, ou restent bloquées en connexion : on traite les deux cas nous-mêmes.
    const echecOuverture = () => {
      // Socket déjà ouverte mais événement `open` pas encore traité (fil principal bloqué) : pas un échec.
      if (this.socket !== s || this.aEteOuverte || s.readyState === OUVERT) return;
      this.detacher();
      try { s.close(); } catch { /* jamais ouverte */ }
      this.surFermeture(1006, reprise);
    };
    const delai = setTimeout(echecOuverture, DELAI_OUVERTURE);
    this.minuteurOuverture = delai;
    s.onerror = echecOuverture;
    s.onclose = (ev) => {
      if (this.socket !== s) return;
      this.socket = null;
      this.arreterMinuteurs();
      this.surFermeture(ev.code, reprise || this.etatConnexion === 'reconnexion');
    };
  }

  private surFermeture(code: number, enReprise: boolean): void {
    const fatal: Partial<Record<number, CodeErreurClient>> = {
      [FERMETURE.remplacee]: 'remplacee',
      [FERMETURE.invalides]: 'expulse',
      [FERMETURE.abus]: 'expulse',
      [FERMETURE.salonFerme]: 'ferme',
      [FERMETURE.interne]: 'interne',
      [FERMETURE.quitte]: 'ferme',
      1009: 'expulse',
    };
    const codeFatal = fatal[code];
    if (codeFatal) {
      this.oublierSession();
      this.arreterReconnexion();
      this.changerEtat('hors_ligne');
      this.erreur(codeFatal, true);
      return;
    }
    if (this.session && (this.aEteOuverte || enReprise)) {
      this.planifierReconnexion();
      return;
    }
    this.changerEtat('hors_ligne');
    if (!this.aEteOuverte) this.erreur('indisponible', true);
  }

  private planifierReconnexion(): void {
    const maintenant = this.maintenant();
    if (!this.reconnexion) {
      this.reconnexion = { debut: maintenant, essais: 0, minuteur: null };
      this.erreur('interrompue', false);
    }
    const r = this.reconnexion;
    if (maintenant - r.debut > (this.options.reconnexionMaxMs ?? RECONNEXION_MAX_DEFAUT)) {
      this.arreterReconnexion();
      this.oublierSession();
      this.changerEtat('hors_ligne');
      this.erreur('perdue', true);
      return;
    }
    this.changerEtat('reconnexion');
    const delai = Math.min(4000, 400 * 2 ** r.essais) * (0.8 + this.aleatoire() * 0.4);
    r.essais++;
    r.minuteur = setTimeout(() => {
      r.minuteur = null;
      if (!this.session || this.reconnexion !== r) return;
      this.connecter([JSON.stringify({ t: 'reprendre', v: VERSION_PROTOCOLE, code: this.session.code, jeton: this.session.jeton })], true);
    }, delai);
  }

  private arreterReconnexion(): void {
    if (this.reconnexion?.minuteur) clearTimeout(this.reconnexion.minuteur);
    this.reconnexion = null;
  }

  private detacher(): void {
    this.arreterMinuteurs();
    const s = this.socket;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    this.socket = null;
  }

  /** Coupe brutalement la connexion courante comme une panne réseau (tests et chien de garde). */
  couper(): void {
    const s = this.socket;
    if (!s) return;
    this.detacher();
    try { s.close(4000, 'coupure'); } catch { /* déjà fermée */ }
    this.surFermeture(1006, this.etatConnexion === 'reconnexion');
  }

  private demarrerMinuteurs(): void {
    this.arreterMinuteurs();
    this.minuteurOuverture = null;
    this.minuteurs.push(setInterval(() => this.envoyer({ t: 'ping', c: this.maintenant() }), PERIODE_PING));
    let veille = this.maintenant();
    this.minuteurs.push(setInterval(() => {
      const t = this.maintenant();
      // Le chien de garde lui-même a été retardé : le fil principal était bloqué (image très longue,
      // onglet gelé). Les messages reçus pendant ce temps attendent encore d'être traités : on ne
      // conclut rien et on repart de maintenant.
      if (t - veille > 2500) this.dernierMessage = t;
      veille = t;
      if (this.socket && this.aEteOuverte && t - this.dernierMessage > SILENCE_MAX) this.couper();
    }, 1000));
  }

  private arreterMinuteurs(): void {
    for (const m of this.minuteurs) clearInterval(m);
    this.minuteurs = [];
    if (this.minuteurOuverture) clearTimeout(this.minuteurOuverture);
    this.minuteurOuverture = null;
  }

  private envoyer(m: MessageClient): void {
    this.envoyerTexte(JSON.stringify(m));
  }

  private envoyerTexte(texte: string): void {
    const partir = () => {
      const s = this.socket;
      if (!s || s.readyState !== OUVERT) return;
      s.send(texte);
      this.stats.envoyes++;
      this.stats.octetsEnvoyes += texte.length;
    };
    if (this.fileEnvoi) this.fileEnvoi.ajouter(partir);
    else partir();
  }

  private recevoirAvecLatence(traiter: () => void): void {
    if (this.fileReception) this.fileReception.ajouter(traiter);
    else traiter();
  }

  // ——————————————————————————————————————— Réception

  private recevoir(texte: string): void {
    this.dernierMessage = this.maintenant();
    this.stats.recus++;
    this.stats.octetsRecus += texte.length;
    let m: MessageServeur;
    try {
      m = JSON.parse(texte) as MessageServeur;
    } catch {
      return;
    }
    if (typeof m !== 'object' || m === null || typeof (m as { t?: unknown }).t !== 'string') return;

    switch (m.t) {
      case 'bienvenue':
        this.session = { code: m.code, jeton: m.jeton, id: m.id };
        this.options.stockage?.ecrire(this.session);
        this.arreterReconnexion();
        this.changerEtat('en_ligne');
        break;
      case 'salon': {
        const avant = this.salon?.phase;
        this.salon = m.salon;
        if (m.salon.phase === 'partie' && avant !== 'partie') this.accumulateur = 0;
        this.evenements.salon?.(m.salon);
        break;
      }
      case 'debut':
        this.partie = { partie: m.partie, duree: m.duree, participants: m.participants, objectifs: m.objectifs };
        this.resultat = null;
        this.dernierEtat = null;
        this.predicteur.reinitialiser();
        this.tampon.vider();
        this.horloge.reinitialiser();
        this.serveurLocal = null;
        this.accumulateur = 0;
        this.evenements.debut?.(this.partie);
        break;
      case 'etat':
        this.surEtat(m);
        break;
      case 'fin':
        this.resultat = m.resultat;
        this.evenements.fin?.(m.resultat);
        break;
      case 'erreur':
        if (m.fatal && (m.code === 'jeton' || m.code === 'introuvable') && this.reconnexion) {
          // La reprise a échoué : la place n'existe plus (délai dépassé, salon fermé). Message du serveur.
          this.arreterReconnexion();
          this.oublierSession();
          this.fermer();
          this.evenements.erreur?.(m.code, m.message, true);
          return;
        }
        if (m.fatal) {
          if (!this.salon) this.oublierSession();
          this.fermer();
        }
        this.evenements.erreur?.(m.code, m.message, m.fatal);
        break;
      case 'pong': {
        const mesure = this.maintenant() - m.c;
        this.rtt = this.rtt === 0 ? mesure : this.rtt + (mesure - this.rtt) * 0.2;
        break;
      }
    }
  }

  private surEtat(m: MessageEtat): void {
    this.dernierEtat = m;
    // Le tick 0 (état initial, répété pendant le compte à rebours) ne dit rien du rythme serveur.
    if (m.k > 0) this.horloge.observer(m.k, this.maintenant());
    const entites = new Map<string, EchantillonDistant>();
    for (const [id, e] of Object.entries(m.j)) entites.set(id, { x: e[0], z: e[1], cap: e[2], vitesse: e[3], action: e[4] === 1 });
    this.tampon.ajouter(m.k, entites);
    if (m.m) {
      const [x, z, vx, vz, cap] = m.m;
      const p: Personnage = { x, z, vx, vz, cap };
      if (this.prediction) this.predicteur.reconcilier(m.a, p);
      else this.serveurLocal = { a: this.serveurLocal?.b ?? p, b: p, recu: this.maintenant() };
    }
    this.evenements.etat?.(m);
  }

  private oublierSession(): void {
    this.session = null;
    this.options.stockage?.ecrire(null);
  }

  private changerEtat(e: EtatConnexion): void {
    if (this.etatConnexion === e) return;
    this.etatConnexion = e;
    this.evenements.connexion?.(e);
  }

  private erreur(code: CodeErreurClient, fatal: boolean): void {
    this.evenements.erreur?.(code, MESSAGES_CLIENT[code], fatal);
  }
}

/**
 * File à retard (latence + gigue aléatoire) qui conserve l'ordre d'arrivée, avec un seul minuteur :
 * deux minuteurs de même échéance peuvent s'inverser dans Node, une file ne le peut pas.
 */
class FileRetardee {
  private file: { echeance: number; f: () => void }[] = [];
  private minuteur: ReturnType<typeof setTimeout> | null = null;
  private derniere = 0;

  constructor(
    private readonly latence: number,
    private readonly gigue: number,
    private readonly maintenant: () => number,
    private readonly aleatoire: () => number,
  ) {}

  ajouter(f: () => void): void {
    const t = this.maintenant();
    this.derniere = Math.max(this.derniere, t + this.latence + this.aleatoire() * this.gigue);
    this.file.push({ echeance: this.derniere, f });
    this.planifier();
  }

  attenteMs(): number {
    return Math.max(0, this.derniere - this.maintenant());
  }

  private planifier(): void {
    if (this.minuteur || this.file.length === 0) return;
    this.minuteur = setTimeout(() => {
      this.minuteur = null;
      const t = this.maintenant();
      while (this.file.length > 0 && this.file[0]!.echeance <= t + 0.5) this.file.shift()!.f();
      this.planifier();
    }, Math.max(0, this.file[0]!.echeance - this.maintenant()));
  }
}
