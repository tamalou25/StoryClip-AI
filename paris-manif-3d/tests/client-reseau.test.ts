// ClientReseau face à un fil principal bloqué (premières images, téléphone lent) : horloge et sockets simulées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientReseau, type Session, type SocketLike } from '../src/reseau/client';
import { REGLES_ZONES } from '../src/reseau/regles-zones';

class SocketFactice implements SocketLike {
  readyState = 0;
  envoyes: string[] = [];
  fermee = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string): void { this.envoyes.push(d); }
  close(): void { this.fermee = true; this.readyState = 3; }
  ouvrir(): void { this.readyState = 1; this.onopen?.({}); }
  recevoir(m: unknown): void { this.onmessage?.({ data: JSON.stringify(m) }); }
}

let horloge = 0;
let sockets: SocketFactice[] = [];
const fabriquer = (session: Session | null = null) => {
  let memoire = session;
  return new ClientReseau({
    url: 'ws://test/ws',
    regles: REGLES_ZONES,
    maintenant: () => horloge,
    fabrique: () => { const s = new SocketFactice(); sockets.push(s); return s; },
    stockage: { lire: () => memoire, ecrire: (s) => { memoire = s; } },
    aleatoire: () => 0.5,
  });
};

beforeEach(() => { vi.useFakeTimers(); horloge = 0; sockets = []; });
afterEach(() => { vi.useRealTimers(); });

/** Fait avancer l'horloge simulée et les minuteurs ensemble. */
function avancer(ms: number): void {
  for (let i = 0; i < ms; i += 100) { horloge += 100; vi.advanceTimersByTime(100); }
}

describe('ClientReseau et fil principal bloqué', () => {
  it('une longue image ne déclenche pas le chien de garde ; un vrai silence, si', () => {
    const c = fabriquer();
    c.creer('A', 'manifestants');
    sockets[0]!.ouvrir();
    sockets[0]!.recevoir({ t: 'bienvenue', v: 1, id: 'j1', code: 'ABCDE', jeton: 'x' });
    avancer(1000);
    // Fil principal bloqué 12 s : l'horloge avance, aucun minuteur ne tourne, puis tout reprend.
    horloge += 12_000;
    vi.advanceTimersByTime(12_000);
    avancer(1000);
    expect(c.etatConnexion).toBe('en_ligne');
    expect(sockets[0]!.fermee).toBe(false);
    // Silence réel de plus de 6 s, fil principal libre : connexion considérée comme coupée.
    avancer(7000);
    expect(sockets[0]!.fermee).toBe(true);
    expect(c.etatConnexion).toBe('reconnexion');
  });

  it('socket ouverte dont l’événement open est retardé : pas de « serveur indisponible »', () => {
    const c = fabriquer();
    const erreurs: string[] = [];
    c.evenements.erreur = (code) => erreurs.push(code);
    c.creer('A', 'manifestants');
    sockets[0]!.readyState = 1; // ouverte côté réseau, mais `open` pas encore traité
    horloge += 9000;
    vi.advanceTimersByTime(9000);
    sockets[0]!.ouvrir();
    expect(erreurs).toEqual([]);
    expect(c.etatConnexion).toBe('en_ligne');
  });

  it('reprise au chargement : le serveur ne répond pas → nouvelles tentatives, pas d’échec immédiat', () => {
    const c = fabriquer({ code: 'ABCDE', jeton: 'x', id: 'j1' });
    const erreurs: string[] = [];
    c.evenements.erreur = (code) => erreurs.push(code);
    expect(c.reprendre()).toBe(true);
    sockets[0]!.onerror?.({}); // refus de connexion
    expect(c.etatConnexion).toBe('reconnexion');
    expect(erreurs).not.toContain('indisponible');
    avancer(1000);
    expect(sockets.length).toBe(2); // nouvel essai
    sockets[1]!.ouvrir();
    expect(JSON.parse(sockets[1]!.envoyes[0]!)).toMatchObject({ t: 'reprendre', code: 'ABCDE', jeton: 'x' });
    sockets[1]!.recevoir({ t: 'bienvenue', v: 1, id: 'j1', code: 'ABCDE', jeton: 'x' });
    expect(c.etatConnexion).toBe('en_ligne');
  });
});
