# Paris Manif 3D (nom provisoire)

Jeu web 3D stylisé : manifestants contre forces de l'ordre, parties de 5 min sur une place compacte inspirée de la place de la République. Mobile (Android, iPhone) et ordinateur.

**État : incrément 2c (Blender)** — place parisienne de fin d'après-midi : façades haussmanniennes modélisées dans Blender (baies profondes, balcons sur consoles, corniches, lucarnes, devantures et stores bannes), monument au piédestal mouluré et statue en bronze patiné, platanes procéduraux (Blender), dallage composé, mobilier Poly Haven, ciel HDRI qui éclaire la scène, personnage Quaternius lissé dans Blender et animé (repos, marche, course, salut). Ressources stockées dans `public/ressources/` (aucun lien externe au lancement), sources Blender dans `blender/`, licences dans `docs/LICENCES.md`, comparaisons avant/après dans `docs/captures/`. Pas encore de camps, de bots, d'objectifs ni de réseau.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173 (ajouter ?qualite=haute|basse, ?test=1 pour le crochet de test)
npm test           # Vitest : simulation, collisions, caméra, validation des intentions
npm run build      # vérification TypeScript + build de production dans dist/
npm run test:e2e   # fumée Playwright (après build) : clavier seul + émulation mobile multitouch
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
| Action (salut, haut du corps) | Espace | Bouton « Action » |
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
