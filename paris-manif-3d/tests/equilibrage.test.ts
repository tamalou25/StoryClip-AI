// Mesure d'équilibre : parties entre bots, par difficulté. Ne s'exécute qu'avec EQUILIBRAGE=1
// (npm run equilibrage) : c'est un outil de réglage, pas un test de non-régression.
import { describe, expect, it } from 'vitest';
import { CARTE_REPUBLIQUE as carte } from '../src/sim/carte';
import { creerMonde, etape } from '../src/sim/monde';
import type { Camp, Difficulte } from '../src/sim/regles';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const N = Number(env.EQUILIBRAGE_PARTIES ?? 16);

describe.skipIf(!env.EQUILIBRAGE)('équilibrage bots contre bots', () => {
  it.each<Difficulte>(['facile', 'normal', 'difficile'])('difficulté %s', (difficulte) => {
    const victoires: Record<Camp, number> = { manif: 0, ordre: 0 };
    const raisons: Record<string, number> = {};
    let duree = 0;
    let dispersions = { manif: 0, ordre: 0 };
    let speciaux = { manif: 0, ordre: 0 };
    let tenue = { manif: 0, ordre: 0 };
    let mobilisation = 0;
    for (let g = 1; g <= N; g++) {
      let m = creerMonde(carte, { campJoueur: null, reglages: { graine: 1000 + g, difficulte } });
      while (m.partie.phase === 'en-cours') m = etape(m, {}, carte);
      victoires[m.partie.vainqueur!]++;
      const r = m.partie.raison!.replace(/\d+[:%]?\d*/g, '#');
      raisons[r] = (raisons[r] ?? 0) + 1;
      duree += m.partie.temps;
      mobilisation += m.partie.mobilisation / m.partie.cibleMobilisation;
      for (const id of m.ordre) {
        const a = m.acteurs[id]!;
        dispersions[a.camp] += a.stats.dispersions;
        speciaux[a.camp] += a.stats.speciaux;
      }
      tenue.manif += m.partie.tenueCumulee.manif;
      tenue.ordre += m.partie.tenueCumulee.ordre;
    }
    const l = (v: number) => (v / N).toFixed(1);
    (globalThis as { process?: { stderr: { write(s: string): void } } }).process?.stderr.write(
      `\n[${difficulte}] manif ${victoires.manif}/${N} · ordre ${victoires.ordre}/${N} · durée moy ${l(duree)} s · mobilisation finale moy ${(mobilisation / N * 100).toFixed(0)} %\n` +
      `  dispersions/partie manif ${l(dispersions.manif)} ordre ${l(dispersions.ordre)} · spéciaux manif ${l(speciaux.manif)} ordre ${l(speciaux.ordre)} · zones·s tenues manif ${l(tenue.manif)} ordre ${l(tenue.ordre)}\n` +
      `  raisons : ${Object.entries(raisons).map(([r, n]) => `${r} ×${n}`).join(' | ')}\n`,
    );
    expect(victoires.manif + victoires.ordre).toBe(N);
  }, 600000);
});
