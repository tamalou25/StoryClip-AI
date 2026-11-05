// Télécharge les ressources tierces listées dans sources.json vers assets-sources/ (non versionné).
// Usage : node scripts/assets/telecharger.mjs
// Enregistre aussi les métadonnées (auteurs, dimensions réelles, licence) dans assets-sources/manifeste.json.

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');
const SORTIE = join(RACINE, 'assets-sources');
const sources = JSON.parse(await readFile(join(ICI, 'sources.json'), 'utf8'));
const manifeste = { genereLe: new Date().toISOString(), elements: [] };

async function existe(f) {
  try { return (await stat(f)).size > 0; } catch { return false; }
}

async function telecharger(url, fichier) {
  if (await existe(fichier)) return;
  await mkdir(dirname(fichier), { recursive: true });
  for (let essai = 1; essai <= 3; essai++) {
    const r = await fetch(url);
    if (r.ok) {
      await writeFile(fichier, Buffer.from(await r.arrayBuffer()));
      console.log('  ✓', fichier.replace(RACINE + '/', ''));
      return;
    }
    console.warn(`  essai ${essai} : ${r.status} ${url}`);
    await new Promise((ok) => setTimeout(ok, 2000 * essai));
  }
  throw new Error(`échec du téléchargement : ${url}`);
}

const json = async (url) => (await fetch(url)).json();

// ——— Poly Haven (CC0) ———
for (const t of sources.polyhavenTextures) {
  console.log('Poly Haven texture', t.id);
  const [fichiers, info] = await Promise.all([json(`https://api.polyhaven.com/files/${t.id}`), json(`https://api.polyhaven.com/info/${t.id}`)]);
  for (const carte of ['Diffuse', 'nor_gl', 'arm']) {
    const f = fichiers[carte][t.resolution].jpg;
    await telecharger(f.url, join(SORTIE, 'polyhaven', t.id, `${carte}.jpg`));
  }
  manifeste.elements.push({ type: 'texture', source: 'Poly Haven', id: t.id, url: `https://polyhaven.com/a/${t.id}`, auteurs: info.authors, dimensionsMm: info.dimensions, licence: 'CC0 1.0', usage: t.usage });
}

for (const m of sources.polyhavenModeles) {
  console.log('Poly Haven modèle', m.id);
  const [fichiers, info] = await Promise.all([json(`https://api.polyhaven.com/files/${m.id}`), json(`https://api.polyhaven.com/info/${m.id}`)]);
  const g = fichiers.gltf[m.resolution].gltf;
  const dossier = join(SORTIE, 'polyhaven', m.id);
  await telecharger(g.url, join(dossier, `${m.id}.gltf`));
  for (const [chemin, f] of Object.entries(g.include)) await telecharger(f.url, join(dossier, chemin));
  manifeste.elements.push({ type: 'modèle', source: 'Poly Haven', id: m.id, url: `https://polyhaven.com/a/${m.id}`, auteurs: info.authors, dimensionsMm: info.dimensions, licence: 'CC0 1.0', usage: m.usage });
}

for (const h of sources.polyhavenHdri) {
  console.log('Poly Haven HDRI', h.id);
  const [fichiers, info] = await Promise.all([json(`https://api.polyhaven.com/files/${h.id}`), json(`https://api.polyhaven.com/info/${h.id}`)]);
  for (const res of h.resolutions) await telecharger(fichiers.hdri[res].hdr.url, join(SORTIE, 'polyhaven', h.id, `${res}.hdr`));
  manifeste.elements.push({ type: 'HDRI', source: 'Poly Haven', id: h.id, url: `https://polyhaven.com/a/${h.id}`, auteurs: info.authors, licence: 'CC0 1.0', usage: h.usage });
}

// ——— ambientCG (CC0) ———
for (const a of sources.ambientcg) {
  console.log('ambientCG', a.id);
  await telecharger(`https://ambientcg.com/get?file=${a.fichier}`, join(SORTIE, 'ambientcg', a.fichier));
  manifeste.elements.push({ type: 'atlas', source: 'ambientCG', id: a.id, url: `https://ambientcg.com/view?id=${a.id}`, auteurs: { 'Lennart Demes (ambientCG)': 'All' }, licence: 'CC0 1.0', usage: a.usage });
}

// ——— Quaternius (CC0) ———
const q = sources.quaternius;
console.log('Quaternius', q.pack);
for (const f of q.fichiers) await telecharger(`${q.base}/${f}`, join(SORTIE, 'quaternius', decodeURIComponent(f).split('/').pop()));
manifeste.elements.push({ type: 'personnages animés', source: 'Quaternius', id: q.pack, url: q.page, auteurs: { Quaternius: 'All' }, licence: q.licence, acces: q._acces });

await writeFile(join(SORTIE, 'manifeste.json'), JSON.stringify(manifeste, null, 2));
console.log('Manifeste écrit :', join('assets-sources', 'manifeste.json'));
