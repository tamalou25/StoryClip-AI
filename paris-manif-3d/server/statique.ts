// Service minimal des fichiers du client construit (dist/) : un seul processus suffit en production.
// Chemins normalisés et confinés au dossier (aucune remontée « .. »), GET/HEAD uniquement.

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export function servirStatique(dossier: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const racine = resolve(dossier);
  let chemin: string;
  try {
    chemin = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  } catch {
    return false;
  }
  if (chemin.includes('\0')) return false;
  if (chemin.endsWith('/')) chemin += 'index.html';
  const fichier = resolve(join(racine, normalize(chemin)));
  if (fichier !== racine && !fichier.startsWith(racine + sep)) return false;
  if (!existsSync(fichier) || !statSync(fichier).isFile()) return false;
  const type = TYPES[extname(fichier).toLowerCase()] ?? 'application/octet-stream';
  const immuable = chemin.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': immuable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(fichier));
  return true;
}
