// Outils des tests multijoueurs : serveur réel sur un port libre, clients indépendants
// (WebSocket global de Node 22, même ClientReseau que le navigateur), attente d'états.

import { WebSocket as WsNode } from 'ws';
import { ClientReseau, type CodeErreurClient, type OptionsClient } from '../../src/reseau/client';
import type { Camp, MessageServeur, ResultatPartie, VueSalon } from '../../src/reseau/protocole';
import { REGLES_ZONES } from '../../src/reseau/regles-zones';
import { demarrerServeur, type OptionsServeur, type ServeurJeu } from '../serveur';

export function serveurDeTest(options: Partial<OptionsServeur> = {}): Promise<ServeurJeu> {
  return demarrerServeur({
    port: 0,
    hote: '127.0.0.1',
    journal: null,
    dureePartieS: 4,
    compteS: 0.3,
    graceS: 3,
    battementMs: 1000,
    connexionsParIp: 200,
    creationsParMinute: 200,
    tentativesParMinute: 2000,
    ...options,
  });
}

export interface ClientTest {
  c: ClientReseau;
  salons: VueSalon[];
  erreurs: { code: CodeErreurClient; fatal: boolean }[];
  fins: ResultatPartie[];
  debuts: number;
  etats: number;
}

export function client(url: string, options: Partial<OptionsClient> = {}): ClientTest {
  const c = new ClientReseau({ url, regles: REGLES_ZONES, reconnexionMaxMs: 8000, ...options });
  const t: ClientTest = { c, salons: [], erreurs: [], fins: [], debuts: 0, etats: 0 };
  c.evenements.salon = (v) => t.salons.push(v);
  c.evenements.erreur = (code, _m, fatal) => t.erreurs.push({ code, fatal });
  c.evenements.fin = (r) => t.fins.push(r);
  c.evenements.debut = () => { t.debuts++; };
  c.evenements.etat = () => { t.etats++; };
  return t;
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend que la condition soit vraie (sondage toutes les 10 ms), sinon échoue avec le message. */
export async function attendre(condition: () => boolean, message: string, delai = 5000, diagnostic?: () => string): Promise<void> {
  const fin = Date.now() + delai;
  while (!condition()) {
    if (Date.now() > fin) throw new Error(`Délai dépassé : ${message}${diagnostic ? ` — ${diagnostic()}` : ''}`);
    await pause(10);
  }
}

/** Fait tourner la boucle de jeu d'un client (≈ 60 i/s) avec une intention fixe ou variable. */
export function piloter(t: ClientTest, intention: () => { dx: number; dz: number; action: boolean }): () => void {
  let precedent = performance.now();
  const id = setInterval(() => {
    const maintenant = performance.now();
    t.c.avancer((maintenant - precedent) / 1000, intention());
    precedent = maintenant;
  }, 16);
  return () => clearInterval(id);
}

/** Crée un salon avec `n` clients et attend que tous se voient. */
export async function salonAvec(url: string, noms: [string, Camp][], options: Partial<OptionsClient> = {}): Promise<ClientTest[]> {
  const [premier, ...autres] = noms;
  const hote = client(url, options);
  hote.c.creer(premier![0], premier![1]);
  await attendre(() => hote.c.session !== null && hote.c.salon !== null, 'création du salon');
  const clients = [hote];
  for (const [nom, camp] of autres) {
    const t = client(url, options);
    t.c.rejoindre(hote.c.session!.code, nom, camp);
    clients.push(t);
  }
  await attendre(() => clients.every((t) => t.c.salon?.joueurs.length === noms.length), 'tous les joueurs se voient');
  return clients;
}

/** Tous prêts puis l'hôte lance ; attend la phase partie chez tout le monde. */
export async function lancer(clients: ClientTest[]): Promise<void> {
  for (const t of clients) t.c.pret(true);
  const diag = () => clients.map((t) => `${t.c.etatConnexion}/${t.c.salon?.phase}/${t.c.salon?.joueurs.map((j) => `${j.nom}:${j.pret}:${j.presence}`).join(',')}/${JSON.stringify(t.erreurs)}`).join(' ; ');
  await attendre(() => clients.every((t) => t.c.salon?.joueurs.every((j) => j.pret || j.presence !== 'connecte')), 'tous prêts', 5000, diag);
  clients[0]!.c.demarrer();
  await attendre(() => clients.every((t) => t.c.salon?.phase === 'partie' && t.c.dernierEtat !== null), 'début de partie', 5000);
}

export function fermerTous(clients: ClientTest[]): void {
  for (const t of clients) t.c.fermer();
}

/** Socket brute (ws) pour envoyer des messages arbitraires, hors ClientReseau. */
export async function socketBrute(url: string, entetes: Record<string, string> = {}, autoPong = true): Promise<{
  ws: WsNode;
  recus: MessageServeur[];
  fermeture: Promise<number>;
}> {
  const ws = new WsNode(url, { headers: entetes, autoPong });
  const recus: MessageServeur[] = [];
  ws.on('message', (d) => recus.push(JSON.parse(String(d)) as MessageServeur));
  const fermeture = new Promise<number>((ok) => ws.on('close', (code) => ok(code)));
  await new Promise<void>((ok, ko) => {
    ws.once('open', () => ok());
    ws.once('error', ko);
  });
  return { ws, recus, fermeture };
}
