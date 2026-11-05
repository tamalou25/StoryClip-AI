# Raccordement aux règles complètes (session gameplay)

Ces fichiers dépendent de la refonte de `src/sim/` (monde à acteurs, souffle, zones, bots) de la PR
`tamalou25/StoryClip-AI#1`, **pas encore fusionnée**. Ils sont donc exclus du build et des tests ici
(`vite.config.ts` → `test.exclude`), mais ont été **validés** sur une fusion locale des trois branches
(05/11/2026) : typecheck serveur OK, `regles-manif.test.ts` 3/3 (dont une partie en ligne à deux clients
avec résultat identique et revanche), suite complète verte.

Après fusion de la PR gameplay :

```bash
cp -r integration/gameplay/src integration/gameplay/server .
```

Puis remplacer `REGLES_ZONES` par `REGLES_MANIF` dans `server/serveur.ts` (`OPTIONS_DEFAUT.regles`) et
`src/client/multi/main.ts`, retirer `integration/**` de `test.exclude`, et adapter les tests qui visent
les objectifs de la carte provisoire (`server/tests/synchro.test.ts`, `revanche` dans `resilience.test.ts`,
`latence.test.ts` : objectif A en (−26, −8)). Restent à faire côté protocole : bouton spécial (`special`)
dans le message `i`, et un champ d'état propre aux règles (souffle, hors-jeu, nuages) pour le HUD.
Détails : `docs/RESEAU.md`, section « Raccordements ».
