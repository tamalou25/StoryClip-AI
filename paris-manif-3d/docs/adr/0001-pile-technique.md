# ADR 0001 — Pile technique

- **Statut** : accepté pour l'incrément 1 ; partie réseau à confirmer à l'incrément 4
- **Date** : 2026-11-05

## Contexte
5–10 h/semaine, 150 € au total, un seul développeur. Mobile + ordinateur dès le MVP, solo avec 8 bots, multijoueur privé 2–4 joueurs, serveur autoritaire. Besoin d'une base petite et lisible.

## Décision

| Élément | Choix | Version épinglée | Raison |
|---|---|---|---|
| Langage | TypeScript (strict) | 6.0.3 | Types partagés client/serveur ; TS 7 (portage natif) écarté pour l'instant : plus récent, aucun gain utile ici |
| Bundler | Vite | 8.3.5 | Démarrage instantané, build statique |
| Moteur 3D | PlayCanvas Engine (sans éditeur) | 2.23.3 | WebGL2/WebGPU, léger sur mobile, MIT, API code seule |
| Tests | Vitest | 5.0.5 | Même config que Vite |
| Navigateur | @playwright/test | 1.63.0 | Aligné sur le Chromium préinstallé de l'environnement |
| Réseau (incrément 4) | ~~Node 22 + Colyseus~~ → Node 22 + `ws` | `ws` 8.22.0 | **Remplacé par l'[ADR 0002](0002-reseau-ws.md)** (versions Colyseus trop mouvantes, synchronisation non alignée sur le pas fixe) |

Versions choisies : dernière version stable publiée depuis au moins deux semaines (vérifié sur le registre npm le 05/11/2026). Toutes exactes (`save-exact`).

### Principes
1. `src/sim/` ne dépend ni du DOM ni de PlayCanvas : même code en solo (navigateur) et sur le serveur.
2. Pas fixe de 30 Hz ; le rendu interpole entre deux pas.
3. Les clients envoient des **intentions** (`{dx, dz, action}`, longueur ≤ 1, clés inconnues rejetées) — jamais une position ni un score. Validation : `validerIntention`.
4. Multijoueur : serveur autoritaire, interpolation des joueurs distants, prédiction + correction du joueur local seulement si nécessaire (à mesurer sous 150 ms).

## Options écartées

| Option | Pourquoi pas maintenant |
|---|---|
| Three.js | Excellent, mais plus « bibliothèque » : boucle, composants et gestion d'entrée à construire ; PlayCanvas fournit déjà application, composants, ombres, résolution adaptative |
| Babylon.js | Plus lourd à télécharger (mobile) |
| Éditeur PlayCanvas / Unity WebGL / Godot web | Éditeur ou export lourd, moins adapté au code partagé avec un serveur Node |
| WebSocket « maison » au lieu de Colyseus | Salons, reconnexion et sérialisation d'état à réécrire |
| Réutiliser le moteur d'Hémicycle | Tour par tour mensuel, aucun rapport avec du temps réel ; seuls des principes sont repris (voir audit) |

## Conséquences
- Bundle actuel ≈ 2,0 Mo (515 ko gzip), presque tout PlayCanvas. À réduire plus tard (imports nommés / découpage) si le chargement mobile est lent.
- npm 10.9.x plante (`Cannot read properties of null (reading 'edgesOut')`) sur l'arbre de pairs optionnels de Vitest (4.1 et 5.0 testés) : contournement `legacy-peer-deps=true` dans `.npmrc`. Vite est une dépendance directe, aucun pair requis n'est perdu. À retirer quand npm sera corrigé.
- Colyseus 0.18 exige Node ≥ 22 : l'hébergement serveur devra le fournir.
