# Audit d'Hémicycle (lecture seule)

- **Dépôt** : https://github.com/tamalou25/hemicycle, branche `main`, révision `0cbb892ed207962a2eef1d26fda1917e8fdd9a06` (04/11/2026, « Merge pull request #39 »)
- **Accès** : clone public anonyme superficiel (`--depth 1`) dans `/home/user/tamalou25/hemicycle`. Aucune écriture, aucun push.
- **Lu** : `AGENTS.md`, `CLAUDE.md`, `package.json`, `vitest.config.js`, `playwright.config.js`, workflows `.github/workflows/`, `docs/adr/0001-multijoueur.md`, `.agents/skills/ECC.md` + `LICENSE-ECC`, `.agents/skills/attentes-proprietaire/SKILL.md`, `src/engine/rng.js`, `e2e/serveur.js`, listes de fichiers.
- **Exécuté dans Hémicycle** : uniquement `git clone/log`, `ls`, `cat`, `grep`, `wc`. **Aucun build, test ni génération.** Rien n'a donc été testé.

## Ce qui existe réellement

| Élément | Constat |
|---|---|
| Pile | JS vanilla (modules ES), Tailwind 3 compilé localement, Vitest 2, Playwright 1.63 (+ axe-core), Capacitor 8 (Android/iOS) — confirmé |
| Déploiement | GitHub Actions → GitHub Pages (statique) + APK de débogage — confirmé |
| Moteur | `src/engine/` ~40 fichiers, ≈ 4 100 lignes, pur `(état, action) → état`, hasard via `rng.js` (mulberry32) |
| Interface | `src/ui/` écrans + composants, ≈ 3 350 lignes |
| Tests | 27 fichiers Vitest (`tests/`), 17 specs Playwright (`e2e/`), projets « ordinateur » 1280×800 et « mobile » Pixel 7 |
| ADR | 0001 multijoueur (reporté, recommande serveur qui rejoue), 0002 mobile, 0003 économie |
| Licence | **Aucun fichier LICENSE à la racine** ; skills ECC copiés sous MIT (`.agents/skills/LICENSE-ECC`) |

## Réutilisable (principes, pas de copie de code)

| Fichier | Réutilisation | Adaptation |
|---|---|---|
| `src/engine/rng.js` | Algorithme mulberry32 pour bots déterministes (incrément 6) | Réécrit en TS ; algorithme du domaine public |
| Règle « moteur pur, graine dans l'état » (`CLAUDE.md`) | Appliquée à `src/sim/` | Temps réel à pas fixe au lieu de tours |
| `docs/adr/0001-multijoueur.md` | Même conclusion : le serveur exécute la simulation, le client n'est pas cru | Temps réel (Colyseus) au lieu d'asynchrone |
| `playwright.config.js` | Idée des deux projets ordinateur / Pixel 7 | Ajout du multitouch (CDP) et du paysage |
| `e2e/serveur.js` | Non nécessaire (Vite preview) | — |
| `capacitor.config.json` | Piste pour stores mobiles, hors MVP | — |

Les règles propres à Hémicycle (répartition Claude/Codex, Tailwind, règles de contenu politique) **ne sont pas appliquées** à ce projet.

## Systèmes entièrement nouveaux
Rendu 3D, boucle temps réel à pas fixe, collisions, caméra 3e personne, commandes tactiles/clavier, bots et navigation, réseau autoritaire et salons, objectifs (cortège, zones), effets (gaz fictif, cordon), mesure de performance mobile.

## Remarque hors périmètre
`e2e/serveur.js` vérifie `fichier.startsWith(RACINE)` sans séparateur final : un dossier voisin au nom préfixé passerait le contrôle. Faible impact (serveur de test local). Non corrigé (lecture seule).
