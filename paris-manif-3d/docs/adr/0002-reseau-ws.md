# ADR 0002 — Réseau : `ws` + salons maison plutôt que Colyseus

- **Statut** : accepté (incréments 4 et 7) ; remplace la ligne « Réseau » de l'ADR 0001
- **Date** : 2026-11-05

## Contexte

L'ADR 0001 prévoyait Node 22 + Colyseus 0.18 pour le multijoueur (2–4 joueurs, salons privés, serveur autoritaire, reconnexion). Besoins précis : simulation à pas fixe 30 Hz partagée (`src/sim/`), intentions numérotées et accusées pour la prédiction/réconciliation, codes courts, limites de taille et de fréquence, 150 € de budget, un seul développeur.

## Vérification des versions (registre npm, 05/11/2026)

| Paquet | Dernière | Publications récentes | Remarque |
|---|---|---|---|
| `colyseus` (méta-paquet) | 0.18.11 (aujourd'hui) | 0.18.10 le 22/10 | dépend de `auth`, `tools`, `monitor`, `playground`, `redis-driver`, `redis-presence`, `ws-transport` ; pairs `vite`, `express`, `zod`, `@pm2/io`, `uwebsockets-transport` |
| `@colyseus/core` | 0.18.27 (aujourd'hui) | 0.18.26 le 03/11, 0.18.25 le 01/11 | 27 correctifs sur la ligne 0.18 ; plages `^0.18.x` |
| `@colyseus/schema` | 5.0.45 (aujourd'hui) | 5.0.44 aujourd'hui | 45 correctifs sur la ligne 5 |
| `@colyseus/sdk` | 0.18.9 (30/10) | 3 versions en 8 jours | 6,3 Mo décompressé (dépend de `ws`, `msgpackr`, `schema`) |
| `ws` | 8.22.1 (31/10) | 8.22.0 le 26/09 | aucune dépendance, 151 ko |

Compatibilité : Colyseus 0.18 exige Node ≥ 22 (fourni). Mais la règle du projet (« dernière stable publiée depuis au moins deux semaines », versions exactes) n'est pas tenable : les plages internes `^0.18.10` / `0.18.x` tirent des versions publiées le jour même, et les pairs facultatifs entrent en conflit avec le contournement `legacy-peer-deps=true` de l'ADR 0001.

## Décision

**`ws` 8.22.0** (versions exactes, ≥ 2 semaines) côté serveur, **WebSocket natif** côté navigateur, et une couche de salons écrite pour le jeu (`server/` + `src/reseau/` : ≈ 2 400 lignes commentaires compris, client réseau inclus).

Avantages concrets, vérifiés par les tests :

1. **Aligné sur le pas fixe** : un instantané par tick, avec l'accusé de la dernière intention appliquée et l'état complet du joueur local ; « une intention = un pas » (personnage figé si l'intention est en retard). Mesuré : 0 correction de prédiction sous 150–190 ms d'aller-retour et gigue. Avec Colyseus, les correctifs d'état partent à leur propre cadence (`patchRate`) et il aurait fallu reconstruire tick et accusé par-dessus le schéma.
2. **Même code client partout** : `ClientReseau` tourne dans le navigateur et dans les tests Node 22 (WebSocket global) ; 5 fichiers de tests multi-clients avec vrais sockets, plus un E2E à trois navigateurs.
3. **Poids** : 0 ko ajouté au client hors notre code (≈ 10 ko gzip pour tout le mode multijoueur) ; serveur construit en un fichier de 48 ko + `ws`.
4. **Surface maîtrisée** : protocole JSON validé clé par clé (`src/reseau/protocole.ts`), limites de taille (`maxPayload`), de débit et par IP, origine, jetons de reprise — tout est dans le dépôt et testé.

Coûts acceptés : reconnexion, réservation de place et salons à maintenir nous-mêmes ; pas de mise à l'échelle sur plusieurs processus (Colyseus la fournit avec Redis) — inutile à l'échelle visée (un processus Node gère des centaines de salons de 4 joueurs à ~4 Ko/s chacun).

## Options écartées

| Option | Pourquoi pas |
|---|---|
| Colyseus 0.18 | Ci-dessus : versions trop mouvantes pour la politique d'épinglage, dépendances et pairs nombreux, synchronisation d'état non alignée sur le tick |
| Socket.IO | Couche de transport en plus (repli HTTP inutile ici), ni salons privés à code ni autorité fournis |
| WebRTC (pair à pair) | Pas d'autorité serveur, NAT, plus complexe ; la latence d'un serveur proche suffit pour ce jeu |
| uWebSockets.js | Plus rapide, mais binaire natif hors npm ; gain sans objet à cette échelle |
| Messages binaires (msgpack) | JSON suffit (≈ 3,8 Ko/s par client à 2 joueurs) et reste lisible ; à reconsidérer si le débit mobile pose problème |

## Conséquences

- Dépendances ajoutées : `ws` 8.22.0 ; développement : `@types/ws` 8.18.2, `@types/node` 22.20.5, `tsx` 4.23.15.
- `tsconfig.server.json` vérifie `server/`, `src/sim/`, `src/reseau/` avec les types Node ; `npm run typecheck` contrôle les deux.
- Revoir cette décision si : plusieurs processus deviennent nécessaires, ou Colyseus 0.18 se stabilise (≥ 2 semaines sans publication) et apporte un besoin qu'on n'a pas.
