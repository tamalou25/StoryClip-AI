# Paris Manif 3D (nom provisoire)

Jeu web 3D stylisé : manifestants contre forces de l'ordre, parties de 5 min sur une place compacte inspirée de la place de la République. Mobile (Android, iPhone) et ordinateur.

**État : incrément 2c (Blender)** — place parisienne de fin d'après-midi : façades haussmanniennes modélisées dans Blender (baies profondes, balcons sur consoles, corniches, lucarnes, devantures et stores bannes), monument au piédestal mouluré et statue en bronze patiné, platanes procéduraux (Blender), dallage composé, mobilier Poly Haven, ciel HDRI qui éclaire la scène, personnage Quaternius lissé dans Blender et animé (repos, marche, course, salut). Ressources stockées dans `public/ressources/` (aucun lien externe au lancement), sources Blender dans `blender/`, licences dans `docs/LICENCES.md`, comparaisons avant/après dans `docs/captures/`. Pas encore de camps ni de bots en solo.

**Multijoueur (incréments 4 et 7)** — salons privés de 2 à 4 joueurs (`multi.html`) : code court, nom, camp, préparation, partie partagée (objectifs, scores, minuteur, résultat calculés par le serveur), revanche, reconnexion. Serveur Node autoritaire, règles provisoires en attendant le raccordement aux règles complètes. Détails : [docs/RESEAU.md](docs/RESEAU.md).
**État : partie solo complète sur ressources réelles** — accueil → choix du camp → partie de 3 ou 5 min → résultat expliqué → revanche. Deux camps asymétriques (manifestants : tenir les zones ; forces de l'ordre : reprendre les zones ou vider la place), souffle et dispersion, rassemblement / cordon, slogan / gaz fictif, dix bots qui naviguent (A*), se coordonnent et se débloquent, trois difficultés, tutoriel interactif, HUD lisible, sons d'événements avec volumes réglables, pause / reprise / recommencer sans état résiduel. Règles : [docs/REGLES.md](docs/REGLES.md).

Décor : place haussmannienne avec textures photographiques PBR (Poly Haven), candélabres, bancs et statue en modèles 3D réels, platanes en feuillage réel (ambientCG), ciel HDRI qui éclaire la scène, personnages humains animés (Quaternius : repos, marche, course, salut) et passants. Toutes les ressources sont stockées dans `public/ressources/` (aucun lien externe au lancement) et sont CC0 — voir `docs/LICENCES.md`. Pas encore de réseau.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173 (ajouter ?qualite=haute|basse, ?test=1 pour le crochet de test)
npm test           # Vitest : règles, zones, souffle, spéciaux, navigation, bots (parties complètes), caméra, intentions
npm run equilibrage # parties bots contre bots par difficulté : taux de victoire, durées, fins (outil de réglage)
npm run build      # vérification TypeScript + build de production dans dist/
npm run test:e2e   # Playwright (après build) : fumée (commandes) + partie complète pour les deux camps, clavier et tactile émulé
```

Vérifications visuelles et mesures (après `npm run build`) :
```bash
node e2e/vues.mjs e2e/captures/vues basse      # captures à cadrage fixe (ajouter « haute » et une liste de vues)
node e2e/mesures.mjs                           # poids téléchargé, appels de rendu, triangles, mémoire GPU déclarée
```

Modèles Blender (Blender 4.5 LTS, voir `blender/README.md`) :
```bash
/opt/blender/blender -b --factory-startup --python blender/scripts/facade.py
```

Multijoueur (deux terminaux) :
```bash
npm run serveur    # serveur de jeu : ws://localhost:2567/ws
```
```bash
npm run dev        # puis http://localhost:5173/multi.html (Vite relaie /ws vers le serveur)
```
Production locale (un seul processus) : `npm run build && npm run serveur:build && PM3D_STATIQUE=dist npm run serveur:start` → `http://localhost:2567/multi.html`. Test navigateur à trois Chromium : `npm run test:multi` (après les deux builds). Variables, ports, Docker : `docs/RESEAU.md`.

Ressources tierces (déjà versionnées ; à relancer seulement pour les régénérer) :
```bash
node scripts/assets/telecharger.mjs   # sources brutes → assets-sources/ (non versionné)
node scripts/assets/preparer.mjs      # versions optimisées → public/ressources/
```

Node ≥ 22.12. `.npmrc` contient `legacy-peer-deps=true` (contournement d'un plantage de npm 10.9 sur les pairs optionnels de Vitest, voir `docs/adr/0001-pile-technique.md`).

## Commandes

| Action | Ordinateur | Mobile |
|---|---|---|
| Courir | ZQSD (AZERTY), WASD (QWERTY), flèches | Pouce n'importe où dans la moitié gauche (joystick flottant) |
| Marcher | Maj + direction | Pousser peu le joystick |
| Caméra manuelle (facultatif) | A / E (AZERTY) = Q / E (QWERTY) | Glisser dans la moitié droite |
| Recentrer la caméra | C | Bouton « Recentrer » |
| Action (maintenue) : rassembler / cordon | Espace | Bouton « Action » |
| Spécial : slogan / gaz fictif | F ou Ctrl | Bouton « Spécial » |
| Pause / reprendre | Échap ou P / Échap ou Entrée | Bouton ❚❚ |

Aucune souris, aucun survol, aucun verrouillage du pointeur requis. La caméra se replace seule derrière le personnage quand il avance.

## Structure

```
src/sim/      simulation pure (aucun DOM) : carte, déplacement + collisions, intentions, monde à pas fixe 30 Hz
src/reseau/   multijoueur pur (navigateur + Node) : protocole validé, adaptateur de règles, prédiction, interpolation, client
src/client/   rendu PlayCanvas, caméra (logique pure dans camera.ts), commandes, menu/pause ; multi/ = page salon privé
server/       serveur de jeu Node (ws) : salons, limites, reconnexion ; server/tests/ = tests multi-clients
tests/        Vitest
e2e/          tests navigateur Playwright (fumée solo, multijoueur à trois navigateurs)
docs/         audit, décisions, roadmap, budget, licences, sécurité
src/sim/      simulation pure (aucun DOM) : carte, déplacement + collisions, intentions, règles (regles.ts), zones (objectifs.ts),
              état de partie (partie.ts, monde.ts), bots (bots.ts), navigation A* (navigation.ts), aléa déterministe (alea.ts)
src/client/   rendu PlayCanvas (décor, personnage, rendu : session « graphismes »), caméra, commandes, HUD (hud.ts), écrans (ecrans.ts),
              repères 3D de partie (effets.ts), sons de jeu (sons-jeu.ts), tutoriel (tuto.ts), boucle (main.ts)
tests/        Vitest
e2e/          Playwright : fumee.mjs (commandes) et partie.mjs (partie complète)
docs/         audit, décisions, règles, roadmap, budget, licences, sécurité
```

Interface simulation → client : le client lit `Monde` (acteurs, zones, nuages, partie) et la liste `monde.evenements` de chaque pas ; il n'envoie que des `Intention` (`{dx, dz, action, special}`), validées par `validerIntention`.

## Documentation

- [Règles du jeu et équilibre](docs/REGLES.md)
- [Audit d'Hémicycle](docs/AUDIT-HEMICYCLE.md)
- [ADR 0001 — pile technique](docs/adr/0001-pile-technique.md)
- [Roadmap et estimation](docs/ROADMAP.md)
- [Budget](docs/BUDGET.md)
- [Licences et provenance](docs/LICENCES.md)
- [ADR 0002 — réseau (`ws` plutôt que Colyseus)](docs/adr/0002-reseau-ws.md)
- [Multijoueur : lancement, protocole, comportements, tests, raccordements](docs/RESEAU.md)
- [Sécurité et réseau](docs/SECURITE.md)

Contenu : simulation de jeu fictive, sans personne, unité ni insigne réels ; effets non réalistes (« gaz fictif »).
