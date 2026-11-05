# Paris Manif 3D (nom provisoire)

Jeu web 3D stylisé : manifestants contre forces de l'ordre, parties de 5 min sur une place compacte inspirée de la place de la République. Mobile (Android, iPhone) et ordinateur.

**État : incrément 1** — scène en volumes simples, personnage, caméra automatique, commandes clavier et tactiles. Pas encore de camps, de bots, d'objectifs ni de réseau.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173 (ajouter ?qualite=haute|basse, ?test=1 pour le crochet de test)
npm test           # Vitest : simulation, collisions, caméra, validation des intentions
npm run build      # vérification TypeScript + build de production dans dist/
npm run test:e2e   # fumée Playwright (après build) : clavier seul + émulation mobile multitouch
```

Node ≥ 22.12. `.npmrc` contient `legacy-peer-deps=true` (contournement d'un plantage de npm 10.9 sur les pairs optionnels de Vitest, voir `docs/adr/0001-pile-technique.md`).

## Commandes

| Action | Ordinateur | Mobile |
|---|---|---|
| Bouger | ZQSD (AZERTY), WASD (QWERTY), flèches | Pouce n'importe où dans la moitié gauche (joystick flottant) |
| Caméra manuelle (facultatif) | A / E (AZERTY) = Q / E (QWERTY) | Glisser dans la moitié droite |
| Recentrer la caméra | C | Bouton « Recentrer » |
| Action (test : bras levé) | Espace | Bouton « Action » |
| Pause / reprendre | Échap ou P / Entrée ou Échap | Bouton ❚❚ |

Aucune souris, aucun survol, aucun verrouillage du pointeur requis. La caméra se replace seule derrière le personnage quand il avance.

## Structure

```
src/sim/      simulation pure (aucun DOM) : carte, déplacement + collisions, intentions, monde à pas fixe 30 Hz
src/client/   rendu PlayCanvas, caméra (logique pure dans camera.ts), commandes, menu/pause
tests/        Vitest
e2e/          test de fumée Playwright
docs/         audit, décisions, roadmap, budget, licences, sécurité
```

## Documentation

- [Audit d'Hémicycle](docs/AUDIT-HEMICYCLE.md)
- [ADR 0001 — pile technique](docs/adr/0001-pile-technique.md)
- [Roadmap et estimation](docs/ROADMAP.md)
- [Budget](docs/BUDGET.md)
- [Licences et provenance](docs/LICENCES.md)
- [Sécurité et réseau (plan)](docs/SECURITE.md)

Contenu : simulation de jeu fictive, sans personne, unité ni insigne réels ; effets non réalistes (« gaz fictif »).
