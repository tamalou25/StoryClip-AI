// Serveur de jeu : HTTP (santé + fichiers statiques facultatifs) et WebSocket sur /ws.
// Rôle : authentifier rien, ne croire rien. Chaque message est borné en taille (maxPayload), limité
// en fréquence, validé (protocole.ts) puis routé vers LE salon de la connexion uniquement.
// Une boucle unique à 30 Hz fait avancer tous les salons ; une erreur dans un salon ne ferme que lui.

import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { DT, FREQUENCE } from '../src/sim/monde';
import {
  ALPHABET_CODE,
  CHEMIN_WS,
  FERMETURE,
  LONGUEUR_CODE,
  MESSAGES_ERREUR,
  TAILLE_MAX_MESSAGE,
  VERSION_PROTOCOLE,
  decoderMessageClient,
  normaliserCode,
  type CodeErreur,
  type MessageClient,
  type MessageServeur,
} from '../src/reseau/protocole';
import type { ReglesPartie } from '../src/reseau/regles';
import { REGLES_ZONES } from '../src/reseau/regles-zones';
import { FenetreGlissante, SeauJetons } from './limiteur';
import { Salon, type Connexion, type Journal, type Siege } from './salon';
import { servirStatique } from './statique';

export interface OptionsServeur {
  port: number;
  hote: string;
  /** Origines autorisées (en-tête Origin) ; null = toutes (développement uniquement). */
  origines: string[] | null;
  /** Dossier du client construit (dist/) à servir, ou null. */
  statique: string | null;
  dureePartieS: number;
  compteS: number;
  graceS: number;
  salonsMax: number;
  connexionsParIp: number;
  creationsParMinute: number;
  tentativesParMinute: number;
  /** Faire confiance à X-Forwarded-For (derrière un proxy inverse seulement). */
  confianceProxy: boolean;
  /** Intervalle de contrôle de vie des sockets (ping WebSocket), ms. */
  battementMs: number;
  journal: Journal | null;
  regles: ReglesPartie<unknown>;
}

export const OPTIONS_DEFAUT: OptionsServeur = {
  port: 2567,
  hote: '0.0.0.0',
  origines: null,
  statique: null,
  dureePartieS: 300,
  compteS: 3,
  graceS: 30,
  salonsMax: 200,
  connexionsParIp: 16,
  creationsParMinute: 6,
  tentativesParMinute: 30,
  confianceProxy: false,
  battementMs: 5000,
  journal: journalConsole,
  regles: REGLES_ZONES as ReglesPartie<unknown>,
};

const TAMPON_SORTIE_MAX = 256 * 1024; // client trop lent : déconnecté plutôt que de saturer la mémoire
const INACTIF_SANS_SALON_MS = 120_000;
const FENETRE_ABUS_MS = 10_000;
const INVALIDES_MAX = 20; // par fenêtre de 10 s
const REJETS_MAX = 100; // messages au-delà du débit autorisé, par fenêtre de 10 s

export function journalConsole(evenement: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), evenement, ...details }));
}

interface ClientConnecte {
  ws: WebSocket;
  ip: string;
  connexion: Connexion;
  salon: Salon | null;
  siege: Siege | null;
  seau: SeauJetons;
  seauSalon: SeauJetons;
  invalides: number;
  rejets: number;
  fenetre: number;
  dernierAvertissement: number;
  ouverture: number;
  vivant: boolean;
}

export interface ServeurJeu {
  readonly port: number;
  readonly url: string;
  readonly salons: ReadonlyMap<string, Salon>;
  stats(): { salons: number; connexions: number; ticks: number; retardMaxMs: number };
  fermer(): Promise<void>;
}

export async function demarrerServeur(partiel: Partial<OptionsServeur> = {}): Promise<ServeurJeu> {
  const o: OptionsServeur = { ...OPTIONS_DEFAUT, ...partiel };
  const journal: Journal = o.journal ?? (() => {});
  const maintenant = () => performance.now();
  const salons = new Map<string, Salon>();
  const clients = new Set<ClientConnecte>();
  const parIp = new Map<string, number>();
  const creations = new FenetreGlissante(o.creationsParMinute, 60_000, maintenant);
  const tentatives = new FenetreGlissante(o.tentativesParMinute, 60_000, maintenant);
  let ticks = 0;
  let retardMaxMs = 0;

  const http: Server = createServer((req, res) => repondreHttp(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: TAILLE_MAX_MESSAGE, perMessageDeflate: false });

  function repondreHttp(req: IncomingMessage, res: ServerResponse): void {
    const chemin = (req.url ?? '/').split('?')[0]!;
    if (chemin === '/sante') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, version: VERSION_PROTOCOLE, salons: salons.size, connexions: clients.size }));
      return;
    }
    if (o.statique && servirStatique(o.statique, req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  }

  http.on('upgrade', (req, socket, tete) => {
    const refuser = (statut: string) => {
      socket.write(`HTTP/1.1 ${statut}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if ((req.url ?? '').split('?')[0] !== CHEMIN_WS) return refuser('404 Not Found');
    if (o.origines && !o.origines.includes(req.headers.origin ?? '')) {
      journal('origine_refusee', {});
      return refuser('403 Forbidden');
    }
    const ip = adresse(req, o.confianceProxy);
    if ((parIp.get(ip) ?? 0) >= o.connexionsParIp) return refuser('429 Too Many Requests');
    if (clients.size >= o.salonsMax * 6) return refuser('503 Service Unavailable');
    wss.handleUpgrade(req, socket, tete, (ws) => accueillir(ws, ip));
  });

  function accueillir(ws: WebSocket, ip: string): void {
    parIp.set(ip, (parIp.get(ip) ?? 0) + 1);
    const connexion: Connexion = {
      envoyer(m: MessageServeur) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > TAMPON_SORTIE_MAX) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify(m));
      },
      fermer(code: number, raison: string) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, raison);
      },
    };
    const t = maintenant();
    const c: ClientConnecte = {
      ws, ip, connexion, salon: null, siege: null,
      seau: new SeauJetons(60, 40, maintenant), // intentions à 30/s + marge, rafale de 2 s
      seauSalon: new SeauJetons(10, 3, maintenant), // messages de salon : 3/s
      invalides: 0, rejets: 0, fenetre: t, dernierAvertissement: -Infinity, ouverture: t, vivant: true,
    };
    clients.add(c);
    ws.on('pong', () => { c.vivant = true; });
    ws.on('message', (donnees, binaire) => {
      try {
        recevoir(c, donnees, binaire);
      } catch (e) {
        journal('erreur_message', { erreur: String(e) });
      }
    });
    ws.on('error', () => { /* suivi de 'close' */ });
    ws.on('close', () => {
      clients.delete(c);
      const n = (parIp.get(ip) ?? 1) - 1;
      if (n <= 0) parIp.delete(ip);
      else parIp.set(ip, n);
      if (c.salon && c.siege) c.salon.deconnexion(c.siege, connexion);
      c.salon = null;
      c.siege = null;
    });
  }

  function avertir(c: ClientConnecte, code: CodeErreur): void {
    const t = maintenant();
    if (t - c.dernierAvertissement < 1000) return;
    c.dernierAvertissement = t;
    c.connexion.envoyer({ t: 'erreur', code, message: MESSAGES_ERREUR[code], fatal: false });
  }

  function compterAbus(c: ClientConnecte, type: 'invalide' | 'rejet'): void {
    const t = maintenant();
    if (t - c.fenetre > FENETRE_ABUS_MS) {
      c.fenetre = t;
      c.invalides = 0;
      c.rejets = 0;
    }
    if (type === 'invalide') {
      if (++c.invalides > INVALIDES_MAX) {
        journal('expulsion', { raison: 'invalides' });
        c.connexion.fermer(FERMETURE.invalides, 'messages invalides');
        return;
      }
      avertir(c, 'invalide');
    } else {
      if (++c.rejets > REJETS_MAX) {
        journal('expulsion', { raison: 'debit' });
        c.connexion.fermer(FERMETURE.abus, 'trop de messages');
        return;
      }
      avertir(c, 'trop_rapide');
    }
  }

  function recevoir(c: ClientConnecte, donnees: RawData, binaire: boolean): void {
    if (!c.seau.prendre()) return compterAbus(c, 'rejet');
    if (binaire) return compterAbus(c, 'invalide');
    const texte = Buffer.isBuffer(donnees) ? donnees.toString('utf8') : Buffer.concat(donnees as Buffer[]).toString('utf8');
    const m = decoderMessageClient(texte);
    if (!m) return compterAbus(c, 'invalide');
    if (m.t !== 'i' && m.t !== 'ping' && !c.seauSalon.prendre()) return compterAbus(c, 'rejet');

    if (c.salon && c.siege) {
      if (m.t === 'creer' || m.t === 'rejoindre' || m.t === 'reprendre') return compterAbus(c, 'invalide');
      if (m.t === 'quitter') {
        const { salon, siege } = c;
        c.salon = null;
        c.siege = null;
        salon.quitter(siege);
        return;
      }
      c.salon.message(c.siege, m);
      return;
    }
    entrer(c, m);
  }

  /** Messages d'une connexion qui n'appartient encore à aucun salon. */
  function entrer(c: ClientConnecte, m: MessageClient): void {
    const refuser = (code: CodeErreur) => c.connexion.envoyer({ t: 'erreur', code, message: MESSAGES_ERREUR[code], fatal: true });
    switch (m.t) {
      case 'ping':
        c.connexion.envoyer({ t: 'pong', c: m.c, k: 0 });
        return;
      case 'creer': {
        if (m.v !== VERSION_PROTOCOLE) return refuser('version');
        if (!creations.autoriser(c.ip)) return refuser('limite');
        if (salons.size >= o.salonsMax) return refuser('serveur_plein');
        const code = nouveauCode();
        const salon = new Salon(code, {
          regles: o.regles,
          dureePartieTicks: Math.round(o.dureePartieS * FREQUENCE),
          compteTicks: Math.round(o.compteS * FREQUENCE),
          graceMs: o.graceS * 1000,
          maintenant,
          journal,
        });
        salons.set(code, salon);
        journal('salon_cree', { salon: code, salons: salons.size });
        const r = salon.rejoindre(m.nom, m.camp, c.connexion);
        if ('erreur' in r) return refuser(r.erreur);
        c.salon = salon;
        c.siege = r.siege;
        return;
      }
      case 'rejoindre':
      case 'reprendre': {
        if (m.v !== VERSION_PROTOCOLE) return refuser('version');
        if (!tentatives.autoriser(c.ip)) return refuser('limite');
        const code = normaliserCode(m.code);
        const salon = code ? salons.get(code) : undefined;
        if (!salon || salon.ferme) return refuser('introuvable');
        const r = m.t === 'rejoindre' ? salon.rejoindre(m.nom, m.camp, c.connexion) : salon.reprendre(m.jeton, c.connexion);
        if ('erreur' in r) return refuser(r.erreur);
        c.salon = salon;
        c.siege = r.siege;
        return;
      }
      default:
        compterAbus(c, 'invalide'); // il faut d'abord rejoindre un salon
    }
  }

  function nouveauCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < LONGUEUR_CODE; i++) code += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
      if (!salons.has(code)) return code;
    }
  }

  // ——— Boucle à pas fixe commune à tous les salons (sans dérive : cadencée sur l'heure de départ).
  const debut = maintenant();
  let prochain = 0;
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  function boucle(): void {
    const t = maintenant();
    let pas = 0;
    while (t >= debut + (prochain + 1) * DT * 1000 && pas < 5) {
      retardMaxMs = Math.max(retardMaxMs, t - (debut + (prochain + 1) * DT * 1000));
      tickSalons();
      prochain++;
      pas++;
    }
    if (pas === 5) prochain = Math.floor((t - debut) / (DT * 1000)); // serveur gelé : on abandonne le retard
    minuteur = setTimeout(boucle, Math.max(0, debut + (prochain + 1) * DT * 1000 - maintenant()));
  }

  function tickSalons(): void {
    ticks++;
    for (const [code, salon] of salons) {
      try {
        salon.tick();
      } catch (e) {
        journal('erreur_salon', { salon: code, erreur: String(e) });
        salon.fermer(FERMETURE.interne, 'erreur interne');
      }
      if (salon.vide()) {
        salons.delete(code);
        if (!salon.ferme) journal('salon_supprime', { salon: code, salons: salons.size });
      }
    }
  }

  // ——— Entretien : sockets mortes (ping/pong), connexions inactives sans salon, compteurs par IP.
  const entretien = setInterval(() => {
    const t = maintenant();
    for (const c of clients) {
      if (!c.vivant) {
        c.ws.terminate();
        continue;
      }
      c.vivant = false;
      c.ws.ping();
      if (!c.salon && t - c.ouverture > INACTIF_SANS_SALON_MS) c.connexion.fermer(FERMETURE.inactif, 'inactif');
    }
    creations.nettoyer();
    tentatives.nettoyer();
  }, o.battementMs);

  await new Promise<void>((ok, ko) => {
    http.once('error', ko);
    http.listen(o.port, o.hote, () => ok());
  });
  boucle();
  const port = (http.address() as AddressInfo).port;
  journal('serveur_demarre', { port, origines: o.origines ?? 'toutes', statique: o.statique });

  return {
    port,
    url: `ws://127.0.0.1:${port}${CHEMIN_WS}`,
    salons,
    stats: () => ({ salons: salons.size, connexions: clients.size, ticks, retardMaxMs }),
    async fermer() {
      if (minuteur) clearTimeout(minuteur);
      clearInterval(entretien);
      for (const salon of salons.values()) salon.fermer(1001, 'arrêt du serveur');
      salons.clear();
      for (const c of clients) c.ws.terminate();
      await new Promise<void>((ok) => wss.close(() => ok()));
      const fermeture = new Promise<void>((ok) => http.close(() => ok()));
      http.closeAllConnections();
      await fermeture;
    },
  };
}

function adresse(req: IncomingMessage, confianceProxy: boolean): string {
  if (confianceProxy) {
    const xff = req.headers['x-forwarded-for'];
    const premiere = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (premiere) return premiere;
  }
  return req.socket.remoteAddress ?? 'inconnue';
}
