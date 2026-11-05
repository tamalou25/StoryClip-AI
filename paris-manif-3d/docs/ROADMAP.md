# Roadmap et estimation

Rythme : 5–10 h/semaine. Heures = travail humain (pilotage, essais, relecture), assistance IA comprise.

| # | Incrément | Estimation initiale (h) | État |
|---|---|---|---|
| 1 | Audit et décisions | 4–6 | ✅ fait |
| 2 | Personnage, caméra, collisions, carte en volumes | 10–16 | ✅ base faite (même session) |
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

## Partie solo complète (05/11/2026)
- Incréments 3, 5, 6 et 8 livrés en solo dans la même session (session « gameplay », en parallèle de la session « graphismes »).
- Validé : Vitest (règles, bots, navigation, parties complètes bots contre bots), build, Playwright (fumée + partie complète pour les deux camps, clavier puis Pixel 7 émulé). Aucun essai sur téléphone réel.
- Restant : incrément 4 (réseau, Colyseus) puis 7 (salons). Prochaine amélioration la plus utile côté solo : mesurer sur un vrai téléphone (11 personnages articulés ≈ 280–430 appels de dessin en qualité basse) et, si besoin, un niveau de détail réduit pour les bots lointains.
