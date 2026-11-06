# Roadmap et estimation

Rythme : 5–10 h/semaine. Heures = travail humain (pilotage, essais, relecture), assistance IA comprise.

| # | Incrément | Estimation initiale (h) | État |
|---|---|---|---|
| 1 | Audit et décisions | 4–6 | ✅ fait |
| 2 | Personnage, caméra, collisions, carte en volumes | 10–16 | ✅ base faite (même session) |
| 3 | Commandes tactiles/clavier, menus, écrans | 12–20 | 🟡 commandes + pause faites ; menus camp/résultats à faire |
| 4 | Essai réseau : 2 clients, serveur autoritaire (`ws`, voir ADR 0002) | 20–30 | ✅ fait (session réseau, 05/11/2026) |
| 5 | Partie complète 5 min, deux camps, victoire, revanche | 20–30 | ⬜ |
| 6 | 8 bots, navigation, déblocage | 20–35 | ⬜ |
| 7 | Salons privés, objectifs synchronisés, départs, reconnexion | 20–35 | 🟡 fait avec des règles provisoires ; raccordement aux règles complètes à faire (voir `docs/RESEAU.md`) |
| 8 | Gaz fictif et cordon (contre-jeu, sortie) | 12–20 | ⬜ |
| 3 | Commandes tactiles/clavier, menus, écrans | 12–20 | ✅ accueil, camp, pause, résultat, revanche, options |
| 4 | Essai réseau : 2 clients, serveur autoritaire (Colyseus) | 20–30 | ⬜ |
| 5 | Partie complète 5 min, deux camps, victoire, revanche | 20–30 | ✅ solo (voir docs/REGLES.md) |
| 6 | 8 bots, navigation, déblocage | 20–35 | ✅ 10 bots, A*, déblocage, 3 difficultés |
| 7 | Salons privés, objectifs synchronisés, départs, reconnexion | 20–35 | ⬜ |
| 8 | Gaz fictif et cordon (contre-jeu, sortie) | 12–20 | ✅ gaz, cordon, slogan, rassemblement |
| 9 | Décor parisien, animations, optimisation, tests réels | 30–48 | ⬜ |
| | **Total** | **150–240** (190–300 avec marge) | |

## Réestimation après l'incrément 1 (05/11/2026)
- Incréments 1, 2 et une partie du 3 ont été produits en une session assistée. Temps humain restant pour les valider sur vrais téléphones : ~2–4 h.
- Restant estimé : **125–200 h** (165–260 h avec marge), soit **4 à 9 mois** à 5–10 h/semaine.
- Risques principaux : performances sur téléphone d'entrée de gamme (non mesurées), réseau sous 150 ms (incrément 4), bots crédibles (incrément 6).

## Réduction de périmètre possible si dépassement
1. Reconnexion limitée → simple retour au menu.
2. Bots : patrouille + poursuite d'objectif sans évitement fin.
3. Décor : volumes stylisés + quelques modèles CC0 au lieu d'une modélisation de la place.
4. Multijoueur 2 joueurs seulement avant 4.

## Prochain petit incrément recommandé (3b, ~4–6 h)
Menu complet au clavier et au toucher : accueil → choix du camp → partie (minuteur 5 min factice) → écran de résultats → revanche, avec état de partie dans `src/sim/` et tests du parcours.

## Incrément 2 visuel (05/11/2026)
| Qualité | Basse (mobile par défaut) | Haute (ordinateur par défaut) |
|---|---|---|
| Résolution | 1× | jusqu'à 2× + MSAA 4× |
| Ombres | 1 cascade, 28 m, 1024 px | 3 cascades, 90 m, 2048 px |
| Post-traitement | aucun | SSAO, bloom léger, étalonnage, vignette |
| Détails | pas de balconnets/lucarnes, houppiers 6 volumes, textures réduites | complet, houppiers 14 volumes, anisotropie 8× |
| Appels de dessin mesurés (headless) | 97 | 542 |

## Incrément 2b — ressources réelles (05/11/2026)
| Qualité | Basse (mobile par défaut) | Haute (ordinateur par défaut) |
|---|---|---|
| Textures PBR (Poly Haven) | 512 px (écorce 256) | 1024 px, dalles 2048 px |
| Ciel / éclairage HDRI | 1k, atlas IBL 256 | 2k, atlas IBL 512 |
| Candélabre / banc / statue | 3 900 / 5 700 / 14 700 triangles | 15 400 / 12 500 / 16 600 triangles |
| Feuillage | 77 cartes par arbre, test alpha | 180 cartes par arbre, alpha-to-coverage (MSAA) |
| Ombres / post-traitement | 1 cascade 30 m, aucun | 3 cascades 90 m, SSAO, bloom, étalonnage |
| Téléchargement | ≈ 5,7 Mo | ≈ 14,6 Mo |
| Appels de dessin mesurés (Chromium headless) | 135 | 598 |

Les i/s ne sont pas mesurables ici (rendu logiciel) : à mesurer sur un vrai téléphone en priorité.

## Incréments 4 et 7 — multijoueur (05/11/2026)
- Salons privés 2–4 joueurs à code court, serveur autoritaire 30 Hz, prédiction + réconciliation (0 correction mesurée sous 150–190 ms), interpolation des distants, reconnexion, revanche, bots de complément : `docs/RESEAU.md`.
- Testé : 99 tests Vitest (dont 5 fichiers multi-clients sur vrais sockets), E2E à trois navigateurs, image Docker. Non testé : vrais téléphones, réseau mobile réel, hébergement public.
- Reste (≈ 8–14 h) : adaptateur vers les règles complètes de la session gameplay (`regles-manif.ts`), bouton spécial et HUD souffle/gaz en ligne, déploiement TLS chez un hébergeur, essais à 4 sur téléphones.

## Incrément 2c — décor Blender (05–06/11/2026)

### Mesures (Chromium headless, rendu WebGL logiciel SwiftShader — PAS un appareil réel)
`node e2e/mesures.mjs` : basse en émulation Pixel 7 paysage (915 × 412), haute en 1280 × 720.

| Mesure | Basse (avant → après) | Haute (avant → après) | Budget retenu |
|---|---|---|---|
| Téléchargé au lancement | 7,6 → **7,0 Mo** | 16,4 → **15,6 Mo** | basse ≤ 8 Mo, haute ≤ 20 Mo |
| Appels de rendu (vue générale) | 413 → **183** | 841 → **438** | basse ≤ 200, haute ≤ 500 |
| Triangles de la scène (toute la couche, sans élimination) | — → **265 000** | — → **814 000** | basse ≤ 300 000, haute ≤ 1 000 000 |
| Mémoire GPU déclarée des textures | 49,6 → **36,9 Mo** | 245 → **159 Mo** | basse ≤ 40 Mo, haute ≤ 200 Mo |
| Mémoire GPU de géométrie | 13,4 → **12,5 Mo** | 38,6 → **43,2 Mo** | — |
| Chargement (serveur local) | **0,34 s** | **0,67 s** | sans valeur pour un réseau mobile |

« Avant » = premières mesures de cet incrément, avant les corrections (lots de rendu par cellules de 200 m,
cube de ciel 256/512 px au lieu de 512/1024, dalles 1024 px au lieu de 2048, atlas des devantures réduit en basse,
équirectangulaire du ciel libéré après génération, niveaux bas du banc et de la statue allégés).
Temps par image non publiés : sous rendu logiciel ils dépendent surtout du nombre de pixels et ne disent rien
d'un GPU de téléphone. **Mesure sur téléphones réels à faire.**

### Pistes restantes pour le mobile
- Compression GPU des textures (KTX2/Basis) : la mémoire des textures est aujourd'hui non compressée (RGBA8).
- Niveaux de détail selon la distance (aujourd'hui, uniquement selon la qualité choisie).
- Ombres : une seule cascade de 30 m en basse ; à désactiver si un téléphone de référence passe sous 30 i/s.
## Partie solo complète (05/11/2026)
- Incréments 3, 5, 6 et 8 livrés en solo dans la même session (session « gameplay », en parallèle de la session « graphismes »).
- Validé : Vitest (règles, bots, navigation, parties complètes bots contre bots), build, Playwright (fumée + partie complète pour les deux camps, clavier puis Pixel 7 émulé). Aucun essai sur téléphone réel.
- Restant : incrément 4 (réseau, Colyseus) puis 7 (salons). Prochaine amélioration la plus utile côté solo : mesurer sur un vrai téléphone (11 personnages articulés ≈ 280–430 appels de dessin en qualité basse) et, si besoin, un niveau de détail réduit pour les bots lointains.
