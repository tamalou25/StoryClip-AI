# Multijoueur : salons privés, serveur autoritaire

État au 05/11/2026 : **utilisable en local** (2 à 4 joueurs, salon privé à code court, partie, résultats, revanche, reconnexion), **testé localement et dans un conteneur Docker**, **pas encore déployé** sur un hébergeur public. Choix technique : [ADR 0002](adr/0002-reseau-ws.md).

## Lancer

| Usage | Commande | Adresse |
|---|---|---|
| Serveur de jeu (développement) | `npm run serveur` (ou `npm run serveur:dev`, redémarre à chaque modification) | `ws://localhost:2567/ws`, santé `http://localhost:2567/sante` |
| Client (développement) | `npm run dev` dans un 2ᵉ terminal | `http://localhost:5173/multi.html` (Vite relaie `/ws` vers le serveur) |
| Production locale, un seul processus | `npm run build && npm run serveur:build && PM3D_STATIQUE=dist npm run serveur:start` | `http://localhost:2567/multi.html` |
| Conteneur | `docker build -t paris-manif-3d .` puis `docker run --rm -p 8080:8080 -e PM3D_ORIGINES=http://localhost:8080 paris-manif-3d` | `http://localhost:8080/multi.html` |

Depuis le menu solo, le bouton « Salon privé à plusieurs (2–4) » ouvre `multi.html`. Pour jouer à plusieurs sur un réseau local : `npm run dev` écoute déjà sur toutes les interfaces (`--host`) ; ouvrir `http://<IP-du-PC>:5173/multi.html` sur les autres appareils.

Paramètres d'URL de `multi.html` : `?code=ABCDE` (pré-remplit le code ; c'est le lien « Copier le lien »), `?serveur=wss://…` (autre serveur), `?qualite=basse|haute`, `?latence=150&gigue=30` (aller-retour simulé, pour essayer), `?prediction=0`, `?test=1` (crochet de test).

### Variables d'environnement du serveur

| Variable | Défaut | Rôle |
|---|---|---|
| `PM3D_PORT` (ou `PORT`) | 2567 (8080 dans l'image) | Port HTTP + WebSocket |
| `PM3D_HOTE` | `0.0.0.0` | Interface d'écoute |
| `PM3D_ORIGINES` | *(vide = toutes)* | Origines autorisées, séparées par des virgules. **Obligatoire en production** (ex. `https://jeu.exemple.fr`) |
| `PM3D_STATIQUE` | *(vide)* | Dossier du client construit à servir (`dist`) |
| `PM3D_DUREE_PARTIE_S` | 300 | Durée d'une partie |
| `PM3D_COMPTE_S` | 3 | Compte à rebours avant le départ |
| `PM3D_GRACE_S` | 30 | Délai de reconnexion pendant lequel une place reste réservée |
| `PM3D_SALONS_MAX` | 200 | Salons simultanés (au-delà : « serveur plein ») |
| `PM3D_CONNEXIONS_PAR_IP` | 16 | Sockets simultanées par adresse |
| `PM3D_CREATIONS_PAR_MINUTE` | 6 | Créations de salon par adresse et par minute |
| `PM3D_TENTATIVES_PAR_MINUTE` | 30 | « Rejoindre » + « reprendre » par adresse et par minute (anti-devinette de codes) |
| `PM3D_CONFIANCE_PROXY` | 0 | `1` derrière **un** proxy inverse : l'adresse est la dernière entrée de `X-Forwarded-For` |
| `PM3D_SERVEUR_WS` (Vite) | `ws://localhost:2567` | Cible du relais `/ws` de `npm run dev` / `npm run preview` |

Aucun secret n'est nécessaire. Journaux : une ligne JSON par événement de salon (création, arrivée, départ, reprise, début, fin), avec identifiants de place (`j1`…) — ni pseudonyme ni adresse IP.

## Architecture

```
navigateur (multi.html)                         serveur Node 22 (server/)
┌──────────────────────────────┐   intentions   ┌───────────────────────────────────┐
│ Commandes → intention 30 Hz  │ ─────────────▶ │ serveur.ts : HTTP, /ws, limites,  │
│ ClientReseau (src/reseau)    │   {t:'i',s,…}  │   validation, routage par salon   │
│  · prédiction + réconciliation│               │ salon.ts : phases, places, hôte,  │
│  · interpolation des distants │ ◀───────────── │   reconnexion, bots, boucle 30 Hz │
│ SceneMulti (PlayCanvas)      │  instantanés   │ ReglesPartie (adaptateur) ────────┼──▶ src/sim/
└──────────────────────────────┘  30 Hz         └───────────────────────────────────┘
```

- `src/reseau/` : code pur partagé (aucun DOM, aucune API Node) — protocole et validation, adaptateur de règles, règles provisoires, prédiction, interpolation, `ClientReseau` (utilisé tel quel par le navigateur **et** par les tests Node).
- `server/` : `serveur.ts` (transport, limites), `salon.ts` (logique de salon, indépendante du transport), `limiteur.ts`, `statique.ts`, `config.ts`, `index.ts`.
- `src/client/multi/` + `multi.html` : interface du salon et rendu. Page séparée pour ne pas toucher au mode solo (`index.html`, `src/client/main.ts`).

### Autorité du serveur

- Le client n'envoie que `{t:'i', s, dx, dz, a}` : numéro croissant, direction (ramenée à une longueur ≤ 1 par le serveur), action. Jamais une position, un score ou un résultat.
- Le serveur avance la simulation à 30 Hz, calcule positions, objectifs, scores, minuteur et résultat, pilote les bots, et envoie à chacun un instantané par pas : son propre état en pleine précision + accusé `a` (dernière intention appliquée), les autres arrondis (cm, centième de radian), scores, objectifs, ticks restants.
- **Une intention = un pas.** Si l'intention d'un joueur n'est pas arrivée à temps (gigue, appareil lent), son personnage est figé pour ce pas (≤ 10 pas, puis arrêt) au lieu de répéter la précédente. Résultat mesuré : la prédiction locale coïncide avec le serveur, **0 correction** sous 150 ms + gigue.
- File d'intentions par joueur : visée 8, maximum 16 ; un numéro déjà vu est ignoré (pas de rejeu ni d'accélération par rafale).

### Prédiction, réconciliation, interpolation

| Élément | Comportement |
|---|---|
| Joueur local | Intention appliquée tout de suite avec la même fonction de déplacement que le serveur (`ReglesPartie.deplacer`) ; à chaque instantané : retour à l'état serveur + rejeu des intentions non confirmées. Écart éventuel absorbé par un décalage visuel amorti (~100 ms), téléportation franche au-delà de 2,5 m. |
| Joueurs distants | Affichés ≈ 1 pas + 2 × gigue mesurée dans le passé (borné à 1–10 pas), interpolés entre deux instantanés ; extrapolation de 3 pas au plus, puis arrêt. |
| Horloge | Estimation du tick serveur sur l'enveloppe des paquets les plus rapides ; l'état initial (tick 0, répété pendant le compte à rebours) est ignoré. |
| Appareil lent | Le client compte le temps réel (le `dt` de PlayCanvas est plafonné à 0,1 s) : même à 2 i/s, la vitesse du personnage est juste. Le chien de garde « 6 s sans message » ignore ses propres retards (image très longue, onglet gelé). |

### Messages

Client → serveur (JSON, ≤ 512 octets, clés exactes, sinon refus) : `creer {v, nom, camp}`, `rejoindre {v, code, nom, camp?}`, `reprendre {v, code, jeton}`, `profil {nom?, camp?}`, `pret {pret}`, `demarrer`, `i {s, dx, dz, a}`, `quitter`, `ping {c}`.
Serveur → client : `bienvenue {id, code, jeton}`, `salon {VueSalon}`, `debut {partie, duree, participants, objectifs}`, `etat {k, a, m, j, s, z, r}`, `fin {resultat}`, `erreur {code, message, fatal}`, `pong {c, k}`. Types exacts : `src/reseau/protocole.ts`.

## Comportements

| Situation | Comportement |
|---|---|
| Créer | Code de 5 caractères tiré au hasard (32 symboles sans 0/O/1/I : 33,5 millions de codes, tentatives limitées par IP). Le créateur est l'hôte. |
| Rejoindre | Nom nettoyé (contrôle, bidi, invisibles retirés ; 16 caractères ; doublon → « Nom 2 »), camp choisi ou le moins rempli. Affichage toujours par `textContent`. |
| Démarrer | Seul l'hôte, quand ≥ 2 joueurs connectés sont tous prêts. Les équipes sont complétées par des bots serveur jusqu'à égalité d'effectif. |
| Partie | Mêmes objectifs, scores, minuteur et résultat pour tous (calculés par le serveur). Pas de pause en ligne : le menu en partie laisse la partie continuer. |
| Créateur (hôte) déconnecté ou parti | L'hôte passe aussitôt au plus ancien joueur connecté ; le créateur revenu est un joueur normal. |
| Coupure réseau / onglet fermé | Place réservée `PM3D_GRACE_S` (30 s). En partie, un bot serveur pilote le personnage en attendant. Le client réessaie seul (0,4 → 4 s entre essais ; il n'abandonne qu'après 90 s, le serveur tranchant avant par « place expirée ») ; après rechargement de la page, `sessionStorage` permet de reprendre sa place. |
| Délai dépassé | Salon / résultats : place libérée. Partie : le personnage reste piloté par un bot jusqu'à la fin et figure « (bot) » au résultat. La reprise est refusée : « Votre place dans ce salon a expiré. » |
| « Quitter » | Comme un délai dépassé, mais immédiat. |
| Même place ouverte ailleurs | L'ancienne connexion est fermée (« reprise dans un autre onglet »). |
| Partie déjà commencée | Rejoindre est refusé ; possible à nouveau pendant les résultats (pour la revanche). |
| Revanche | Chacun vote ; dès que tous les joueurs connectés (≥ 2) ont voté, nouvelle partie avec un état neuf (positions de départ, scores, objectifs, minuteur, files d'intentions). Un joueur qui part ne bloque pas le vote. |
| Tous partis | Salon supprimé ; son code ne mène plus nulle part. |

Erreurs affichées : salon introuvable, salon complet, partie déjà commencée, serveur indisponible, connexion interrompue (bandeau pendant la reconnexion), connexion perdue / place expirée, version différente, trop de tentatives, serveur plein, code mal saisi (vérifié avant envoi).

## Sécurité

Taille ≤ 512 octets (fermeture 1009), seau à jetons par connexion (60 messages, 40/s ; messages de salon 10, 3/s), avertissement puis expulsion (4008) au-delà de 100 refus en 10 s, expulsion (4002) au-delà de 20 messages invalides en 10 s, une connexion n'agit que sur **son** salon (aucun message ne désigne un autre salon), connexions et tentatives limitées par IP, origine vérifiée (`PM3D_ORIGINES`), jetons de reprise de 128 bits comparés à temps constant, ping WebSocket toutes les 5 s (socket morte coupée), client trop lent (> 256 Ko en attente) déconnecté, une exception dans un salon ne ferme que lui. Voir aussi [SECURITE.md](SECURITE.md).

## Tests et mesures (exécutés le 05/11/2026)

| Commande | Contenu | Résultat |
|---|---|---|
| `npm test` | 11 fichiers Vitest, dont 5 multijoueurs avec **vrais sockets** et clients indépendants (`server/tests/`) + modules purs (`tests/reseau.test.ts`, `tests/client-reseau.test.ts`) | 99/99 |
| `npm run test:multi` (après les deux builds) | 3 processus Chromium indépendants contre le serveur de production construit : salon, code, camps, prêt, hôte, erreurs, déplacements dans les deux sens, coupure, rechargement, résultat commun, revanche, départ | voir ci-dessous |
| `PM3D_E2E_URL=http://127.0.0.1:8095 npm run test:multi` | Même scénario contre le **conteneur Docker** | tout vert (avant fusion des ressources graphiques) |
| `npm run test:e2e` | Fumée solo existante | verte |

Couverture des tests Node : création et code (saisie tolérante), noms nettoyés et dédoublonnés, seul l'hôte lance, introuvable / mal formé / complet / commencée / indisponible ; prédiction = serveur, mouvement vu dans les deux sens, 0 correction ; mêmes scores et résultat chez 3 clients, bot de complément ; coupure en partie (bot intérim, reprise, commandes retrouvées), socket morte (ping sans réponse), hôte transféré, rechargement, délai dépassé, départ volontaire, salon supprimé ; revanche sans état résiduel, revanche malgré un départ ; 14 messages invalides puis expulsion sans perturber une partie voisine, 1009, inondation, intention de longueur 50, rejeu de numéros, messages avant d'avoir rejoint, version, limites par IP, `X-Forwarded-For`, origine ; 4 salons en parallèle isolés ; latence.

Mesures sous latence simulée (75 ms par sens + gigue 0–20 ms, soit 160–190 ms d'aller-retour mesuré ; deux salons simultanés ; `server/tests/latence.test.ts`, 5 exécutions) :

| | Avec prédiction (défaut) | Sans prédiction |
|---|---|---|
| Appui → mouvement visible chez soi | **41–54 ms** | 235–270 ms |
| Appui → mouvement visible chez l'autre | 245–273 ms | 239–270 ms |
| Corrections de prédiction | **0** | — |
| Retard d'interpolation des distants | 43–48 ms | 43–47 ms |
| Plus grand saut visible d'un distant (échantillons de 4 ms) | 0,05–0,08 m | 0,05–0,06 m |
| Débit reçu par client (2 joueurs) | 3,8 Ko/s | 3,8 Ko/s |

Conclusion : la prédiction divise par ~5 le délai ressenti, sans aucune correction ; elle reste activée. Trois salons joués simultanément sous cette latence donnent chacun le même résultat chez leurs deux joueurs.

Navigateur headless (rendu logiciel, 1–3 i/s réelles) : déplacements identiques chez A et B à quelques centimètres près, reprise de la place après coupure et après rechargement. **Pas mesuré** : vrais téléphones, vrai réseau mobile, 4 joueurs humains réels, charge de centaines de salons.

## Déploiement

`Dockerfile` (un seul conteneur : client + `/ws`, utilisateur non root, contrôle de santé `/sante`). **Testé localement** : image construite (372 Mo), contrôle de santé « healthy », E2E complet contre le conteneur. **Non testé** : hébergement public, TLS.

En production : servir derrière un proxy TLS (`wss://` obligatoire depuis une page `https://`), définir `PM3D_ORIGINES`, et `PM3D_CONFIANCE_PROXY=1` si un seul proxy inverse est devant (sinon toutes les connexions partagent l'adresse du proxy et la limite par IP bloque vite). Un seul processus suffit pour l'ordre de grandeur visé (une partie = 4 joueurs × ~4 Ko/s) ; plusieurs processus demanderaient un routage des codes vers le bon processus (non fait). Les salons vivent en mémoire : un redémarrage les ferme.

## Raccordements

### Avec la session gameplay (`tamalou25/StoryClip-AI#1`, non fusionnée à ce jour)

La partie multijoueur utilise des **règles provisoires** (`src/reseau/regles-zones.ts` : 3 objectifs, 1 point par seconde de tenue, bots simples) derrière l'adaptateur `ReglesPartie` (`src/reseau/regles.ts`). Elles ne dépendent que de `avancer`/`creerPersonnage` (`src/sim/deplacement.ts`) et de `DT`/`FREQUENCE`, pas de la forme de `Monde` : la fusion de la refonte gameplay ne casse rien. Pour jouer en ligne avec les règles complètes (souffle, cordon, gaz, mobilisation, bots à navigation) :

1. **Fait et validé, en attente de fusion** : `integration/gameplay/src/reseau/regles-manif.ts` implémente `ReglesPartie` au-dessus de `creerMonde`/`etape` de `src/sim/monde.ts` **sans modifier `src/sim/`** ; testé sur une fusion locale des trois branches (`integration/gameplay/server/tests/regles-manif.test.ts` 3/3 : placement des humains, IA pour un absent, figé, partie en ligne à deux avec résultat identique et revanche ; 0 correction de prédiction). Activation : `integration/gameplay/LISEZMOI.md`. Ce que fait l'adaptateur :
   - correspondance des camps `manifestants ↔ manif`, `forces ↔ ordre` ;
   - `creer` : partie « entre bots » de la taille voulue (`campJoueur: null`), puis chaque acteur est attribué à un participant (humain : `bot = false`, sa mémoire d'IA est gardée de côté). Une option `humains: {id, camp, nom}[]` dans `OptionsMonde` côté gameplay serait plus propre ;
   - `ControlePas.automatiques` : l'acteur passe `bot = true` pour ce pas avec sa propre mémoire d'IA, rendue ensuite ;
   - `ControlePas.figes` : rétablir position/vitesse/cap de ces acteurs après le pas ;
   - `vue` : `acteurs` → personnages, `zones[].tenue` (+ `presents` pour « contesté ») → `EtatObjectif`, mobilisation et tenue cumulée → scores ; `resultat` : `partie.phase === 'terminee'` → `vainqueur`.
2. Protocole : ajouter le bouton spécial (`special` de l'intention) au message `i` (`validerMessageClient` refuse aujourd'hui toute clé inconnue) et un champ facultatif d'état propre aux règles dans `etat` (souffle, hors-jeu, nuages de gaz, mobilisation) pour le HUD.
3. Remplacer `REGLES_ZONES` par `REGLES_MANIF` dans `server/serveur.ts` (`OPTIONS_DEFAUT.regles`) et `src/client/multi/main.ts` ; les tests `server/tests/` restent valables (ils ne dépendent que de l'adaptateur), sauf ceux qui visent l'objectif A de la carte provisoire. Les effectifs suivent les participants (humains + bots de complément du salon) ; pour retrouver l'équilibre 6 contre 5 du solo, laisser les règles fixer le nombre de bots (petit ajout à l'interface).

Vérifié sur la fusion locale : `server/`, `src/reseau/` compilent tels quels contre la nouvelle sim, et la suite complète (130 tests, dont ceux de la session gameplay) passe ; seul `synchro.test.ts` a échoué une fois sous très forte charge machine (assertion « 0 correction » depuis assouplie à une correction rare et petite).

La prédiction utilisera `deplacer` = `avancer` simple : les effets non prédits (poussée entre personnages, gaz, élan) produiront de petites corrections, déjà lissées par le client.

### Avec la session graphismes (fusionnée dans cette branche)

- `src/client/multi/scene.ts` utilise `Personnage3D(app, modèle glTF, teintes)` ; les forces de l'ordre ont des teintes sombres sur le **même modèle** que les manifestants. Un modèle propre aux forces (sans insigne) serait plus lisible.
- `Personnage3D` n'a pas de méthode de libération : la scène multijoueur détruit l'entité (`racine.destroy()`), les matériaux clonés ne sont pas libérés explicitement à chaque revanche. Une méthode `detruire()` côté `personnage.ts` est souhaitable.
- La boucle de rendu de `multi/main.ts` reprend celle du mode solo (caméra, décor) : à factoriser quand les deux auront convergé.
