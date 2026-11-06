"""
Générateur procédural de platanes communs (Platanus × hispanica), arbres d'alignement parisiens.

Exécution (depuis la racine de paris-manif-3d) :

    /opt/blender/blender -b --factory-startup --python blender/scripts/platane.py
    /opt/blender/blender -b --factory-startup --python blender/scripts/platane.py -- --apercu <dossier>

Produit, pour chaque variante (a, b, c) et chaque niveau de détail (haute, basse) :
    public/ressources/modeles/platane-<variante>-<niveau>.glb
et enregistre la source blender/sources/platanes.blend (textures référencées en chemin relatif).

Principe :
  1. Squelette déterministe (graine) : fût droit avec empattement, 3 à 5 charpentières guidées vers
     une cible sur l'enveloppe (elles partent presque verticales puis s'ouvrent), branches secondaires
     puis rameaux (3 niveaux de ramification). Les branches poussent pas à pas (tropisme + ondulation)
     dans une enveloppe de houppier en parasol (superellipsoïde lobée et bosselée) ; chaque branche est
     choisie parmi plusieurs candidates pour occuper les vides du houppier.
  2. Maillage par niveau de détail : tubes à 6–10 côtés, rééchantillonnés le long du squelette ;
     chaque branche part de l'axe de sa mère (base noyée dans la mère : pas de trou à la jonction).
     UV d'écorce en mètres : U = abscisse sur la circonférence, V = longueur le long de la branche.
  3. Feuillage : cartes carrées (UV 0–1, tige en bas, v = 0 en bas dans Blender ; l'exportateur glTF
     retourne V, ce qui est la convention attendue par PlayCanvas) attachées au bout de chaque rameau,
     complétées par des cartes le long des rameaux et des cartes « de comblement » ; sélection par
     échantillonnage du point le plus éloigné (répartition homogène, houppier plein) ; normales
     personnalisées = normale de l'ellipsoïde du houppier en chaque sommet (vers l'extérieur).
  4. Deux objets par fichier : « bois » (matériau `ecorce`) et « feuillage » (matériau `feuillage`),
     exportés en GLB sans images ; relecture du GLB pour vérifier triangles, bornes, matériaux, UV,
     normales.

Repère Blender : Z vertical (l'exportateur glTF convertit en +Y), origine au pied du tronc, sol à 0.
"""

import bisect
import json
import math
import random
import struct
import sys
import time
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

# ——————————————————————————————————————————————————————————————— Chemins

RACINE = Path(__file__).resolve().parents[2]
DOSSIER_MODELES = RACINE / 'public' / 'ressources' / 'modeles'
DOSSIER_TEXTURES = RACINE / 'public' / 'ressources' / 'textures'
FICHIER_BLEND = RACINE / 'blender' / 'sources' / 'platanes.blend'

HAUT = Vector((0.0, 0.0, 1.0))
DEG = math.pi / 180.0

# ——————————————————————————————————————————————————————————————— Paramètres

# Trois variantes de la même espèce, à la même échelle : nombre de charpentières, hauteur du fût,
# forme et asymétrie du houppier différentes.
#   fut : hauteur de la première charpentière (m) ; meneur : élévation (degrés, vue du centre du houppier)
#   de la cible de la charpentière la plus haute, qui fait office de flèche ; ouverture : élévation des
#   cibles des autres charpentières ; houppier : centre z, demi-axes a (horizontal), b_haut, b_bas,
#   exposant q (> 2 : dôme plus plat), décalage horizontal, amplitude des lobes et des bosses.
VARIANTES = {
    'a': dict(
        graine=1101, fut=3.5, charpentieres=4, meneur=(68, 80), ouverture=(5, 32), echelle_tronc=1.0,
        inclinaison=(0.0, 0.0),
        houppier=dict(z=7.3, a=3.45, b_haut=3.0, b_bas=2.3, q=2.2, decalage=(0.15, 0.05), lobes=0.10, bosses=0.11),
    ),
    'b': dict(
        graine=2203, fut=3.3, charpentieres=5, meneur=(48, 60), ouverture=(-5, 25), echelle_tronc=1.04,
        inclinaison=(0.0, 0.0),
        houppier=dict(z=7.0, a=3.4, b_haut=2.95, b_bas=2.1, q=2.35, decalage=(-0.1, 0.1), lobes=0.09, bosses=0.13),
    ),
    'c': dict(
        graine=3307, fut=3.75, charpentieres=3, meneur=(68, 80), ouverture=(8, 38), echelle_tronc=0.96,
        inclinaison=(1.6, 35.0),  # degrés d'inclinaison du fût, azimut (degrés)
        houppier=dict(z=7.6, a=3.25, b_haut=3.15, b_bas=2.4, q=2.1, decalage=(0.4, -0.3), lobes=0.12, bosses=0.14),
    ),
}

# Niveaux de détail. cotes : nombre de côtés des tubes par niveau (0 = fût, 1 = charpentières,
# 2 = branches, 3 = rameaux) ; segment : longueur visée d'un segment de tube (m) ; taille : côté des
# cartes (m) ; sortie : inclinaison des cartes vers l'extérieur ; desordre : dispersion de leur face ;
# debord : fraction d'enveloppe que les coins d'une carte ne doivent pas dépasser (si possible).
NIVEAUX = {
    'haute': dict(
        cotes={0: 10, 1: 8, 2: 6, 3: 6}, segment={1: 0.5, 2: 0.45, 3: 0.42}, segments_min={1: 6, 2: 3, 3: 2},
        rameaux=True, cartes=320, taille=(1.2, 1.7), sortie=0.2, desordre=1.3, debord=1.2, triangles_max=5000,
        fut=[0.0, 0.1, 0.25, 0.5, 0.9, 1.5, 2.2, 2.9],
    ),
    'basse': dict(
        cotes={0: 8, 1: 6, 2: 6}, segment={1: 1.3, 2: 1.0}, segments_min={1: 4, 2: 2},
        rameaux=False, cartes=110, taille=(1.8, 2.3), sortie=0.2, desordre=1.0, debord=1.1, triangles_max=900,
        fut=[0.0, 0.3, 1.8],
    ),
}

MAX_BRANCHES = 30  # créneaux de branches secondaires (niveau 2) au plus
MAX_RAMEAUX = 150  # créneaux de rameaux (niveau 3) au plus
SEUIL_ALPHA = 0.45  # identique à alphaTest côté PlayCanvas
TEINTE_FEUILLAGE = '#a7b394'  # teinte appliquée au rameau côté PlayCanvas (aperçu fidèle)
TAILLE_TEXTURE_ECORCE = 1.5  # la photo d'écorce couvre 1,5 m × 1,5 m réels
PIED_TIGE = 0.04  # la tige du rameau touche le bas de l'image à v ≈ 0,04


# ——————————————————————————————————————————————————————————————— Aléa et outils

class Alea(random.Random):
    """Générateur pseudo-aléatoire déterministe (Mersenne Twister de Python, graine entière)."""

    def entre(self, a, b):
        return a + (b - a) * self.random()

    def direction(self):
        z = self.uniform(-1.0, 1.0)
        t = self.uniform(0.0, 2.0 * math.pi)
        r = math.sqrt(max(0.0, 1.0 - z * z))
        return Vector((r * math.cos(t), r * math.sin(t), z))


def lisse(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def perpendiculaire(v):
    ref = Vector((0, 0, 1)) if abs(v.z) < 0.9 else Vector((1, 0, 0))
    return v.cross(ref).normalized()


def tourner_vers(d, perp, angle):
    """Écarte la direction d d'un angle vers la direction perpendiculaire perp."""
    return (d * math.cos(angle) + perp * math.sin(angle)).normalized()


def couleur_lineaire(hexa):
    def canal(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hexa.lstrip('#')
    return tuple(canal(int(h[i:i + 2], 16)) for i in (0, 2, 4))


# ——————————————————————————————————————————————————————————————— Enveloppe du houppier

class Houppier:
    """Enveloppe en parasol : superellipsoïde (dôme haut plus haut que le dessous), lobée en azimut."""

    def __init__(self, p, rng):
        self.c = Vector((p['decalage'][0], p['decalage'][1], p['z']))
        self.a, self.bh, self.bb, self.q = p['a'], p['b_haut'], p['b_bas'], p['q']
        amp = p['lobes']
        self.lobes = [(2, amp * rng.entre(0.6, 1.0), rng.entre(0, 6.283)),
                      (3, amp * rng.entre(0.5, 0.9), rng.entre(0, 6.283)),
                      (5, amp * rng.entre(0.2, 0.5), rng.entre(0, 6.283))]
        # Bosses en 3D (masses de feuillage) : somme d'ondes sur la direction depuis le centre.
        self.bosses = [(rng.direction() * rng.entre(3.0, 5.0), rng.entre(0, 6.283), p['bosses'] / 3.0)
                       for _ in range(6)]

    def rayon_horizontal(self, phi):
        return self.a * (1.0 + sum(m * math.cos(k * phi + ph) for k, m, ph in self.lobes))

    def fraction(self, p):
        """1 sur l'enveloppe, < 1 dedans, > 1 dehors."""
        d = p - self.c
        r = math.hypot(d.x, d.y)
        a = self.rayon_horizontal(math.atan2(d.y, d.x))
        b = self.bh if d.z > 0 else self.bb
        f = ((r / a) ** self.q + (abs(d.z) / b) ** self.q) ** (1.0 / self.q)
        lg = d.length
        if lg > 1e-6:
            u = d / lg
            f /= 1.0 + sum(m * math.sin(w.dot(u) + ph) for w, ph, m in self.bosses)
        return f

    def normale(self, p):
        """Normale de l'ellipsoïde (a, a, b) passant par p : direction « vers l'extérieur » du houppier."""
        d = p - self.c
        b = self.bh if d.z > 0 else self.bb
        n = Vector((d.x / self.a ** 2, d.y / self.a ** 2, d.z / b ** 2))
        return n.normalized() if n.length > 1e-6 else HAUT.copy()

    def exterieur_horizontal(self, p, defaut):
        h = Vector((p.x - self.c.x, p.y - self.c.y, 0.0))
        if h.length < 0.25:
            h = Vector((defaut.x, defaut.y, 0.0))
        return h.normalized() if h.length > 1e-6 else Vector((1, 0, 0))

    def point_surface(self, u, f=1.0):
        """Point de l'enveloppe (fraction f) dans la direction unitaire u depuis le centre."""
        lo, hi = 0.0, 12.0
        for _ in range(40):
            m = (lo + hi) / 2
            if self.fraction(self.c + u * m) < f:
                lo = m
            else:
                hi = m
        return self.c + u * lo


# ——————————————————————————————————————————————————————————————— Squelette

class Branche:
    def __init__(self, niveau, pts, r0, r1, k=1.0, parent=None, s_parent=0.0, profil=None):
        self.niveau = niveau
        self.pts = pts
        self.cum = [0.0]
        for i in range(1, len(pts)):
            self.cum.append(self.cum[-1] + (pts[i] - pts[i - 1]).length)
        self.L = self.cum[-1]
        self.r0, self.r1, self.k = r0, r1, k
        self.profil = profil
        self.parent = parent
        self.s_parent = s_parent
        self.enfants = []
        self.u0 = 0.0
        self.v0 = 0.0
        if parent is not None:
            parent.enfants.append(self)

    def rayon(self, s):
        if self.profil:
            return self.profil(s)
        t = min(1.0, max(0.0, s / self.L))
        return self.r1 + (self.r0 - self.r1) * (1.0 - t) ** self.k

    def _indice(self, s):
        s = min(max(s, 0.0), self.L)
        i = max(1, min(len(self.cum) - 1, bisect.bisect_left(self.cum, s)))
        a, b = self.cum[i - 1], self.cum[i]
        t = 0.0 if b <= a else (s - a) / (b - a)
        return i, t

    def position(self, s):
        i, t = self._indice(s)
        return self.pts[i - 1].lerp(self.pts[i], t)

    def tangente(self, s):
        i, _ = self._indice(s)
        return (self.pts[i] - self.pts[i - 1]).normalized()

    @property
    def bout(self):
        return self.pts[-1]


class Arbre:
    def __init__(self, nom, houppier):
        self.nom = nom
        self.houppier = houppier
        self.branches = []  # ordre parent avant enfants

    def ajouter(self, b):
        self.branches.append(b)
        return b

    def niveau(self, n):
        return [b for b in self.branches if b.niveau == n]


def ondulation(rng, amp):
    """Petite ondulation lisse de la direction (somme de sinus) : pas de segments droits raides."""
    f = [rng.entre(1.2, 2.6) for _ in range(3)]
    ph = [rng.entre(0, 6.283) for _ in range(3)]
    return lambda s: Vector((math.sin(f[0] * s + ph[0]), math.sin(f[1] * s + ph[1]),
                             0.6 * math.sin(f[2] * s + ph[2]))) * amp


def pousser(depart, d0, houppier, f_arret, longueur_max, cible, k_tropisme, ond, pas):
    """Croissance pas à pas : la direction tend vers cible(p) (tropisme) et ondule. S'arrête au bord
    de l'enveloppe (fraction ≥ f_arret) une fois entrée dans le houppier."""
    p = depart.copy()
    d = d0.normalized()
    pts = [p.copy()]
    s = 0.0
    entre = houppier.fraction(p) < 1.0  # départ dans l'enveloppe : arrêt dès qu'on dépasse f_arret
    while s < longueur_max:
        c = cible(p, d, s)
        d = (d + (c - d) * (k_tropisme * pas) + ond(s) * pas).normalized()
        p = p + d * pas
        s += pas
        pts.append(p.copy())
        f = houppier.fraction(p)
        if f < f_arret:
            entre = True
        elif entre and s > 0.25:
            break
    return pts


def distance_min(p, points, plafond=3.0):
    m = plafond * plafond
    for q in points:
        dx, dy, dz = p.x - q.x, p.y - q.y, p.z - q.z
        d = dx * dx + dy * dy + dz * dz
        if d < m:
            m = d
    return math.sqrt(m)


def generer_squelette(nom, v):
    rng = Alea(v['graine'])
    h = Houppier(v['houppier'], rng)
    arbre = Arbre(nom, h)

    # — Fût : droit (légère inclinaison éventuelle), empattement à la base, léger renflement à la fourche.
    n = v['charpentieres']
    hf = v['fut']
    departs = sorted([hf] + [hf + rng.entre(0.12, 0.55) for _ in range(n - 1)])
    h_sommet = departs[-1] + 0.35
    incl, az_incl = v['inclinaison'][0] * DEG, v['inclinaison'][1] * DEG
    pente = Vector((math.cos(az_incl), math.sin(az_incl), 0.0)) * math.tan(incl)
    nb = int(h_sommet / 0.1) + 1
    pts_fut = [Vector((0, 0, 0)) + (pente + HAUT) * (h_sommet * i / (nb - 1)) for i in range(nb)]
    e = v['echelle_tronc']

    def profil_fut(s, hf=hf, e=e):
        return e * (0.19 - 0.006 * s + 0.035 * math.exp(-s / 0.3)
                    + 0.018 * math.exp(-((s - hf - 0.2) / 0.45) ** 2))

    fut = arbre.ajouter(Branche(0, pts_fut, 0, 0, profil=profil_fut))
    fut.lobes = (rng.entre(0, 6.283), rng.entre(0, 6.283), rng.entre(0, 6.283))
    fut.hf = hf
    fut.u0, fut.v0 = rng.entre(0, 1.5), rng.entre(0, 1.5)

    # — Charpentières : chacune vise un point de l'enveloppe (azimut réparti, élévation propre à la
    # variante). Elle part presque verticale puis se laisse guider vers sa cible : elle monte puis
    # s'ouvre, en courbe continue, et finit toujours dans le houppier.
    phi0 = rng.entre(0, 2 * math.pi)
    ordre = list(range(n))
    rng.shuffle(ordre)
    charpentieres = []
    for rang, i in enumerate(ordre):
        z0 = departs[rang]
        phi = phi0 + 2 * math.pi * i / n + rng.entre(-0.3, 0.3)
        meneur = v['meneur'] and rang == n - 1  # la plus haute devient la flèche (axe central)
        if meneur:
            th0 = rng.entre(3, 8) * DEG
            elev = rng.entre(*v['meneur']) * DEG
            f_arret, r_rel = rng.entre(0.78, 0.84), 0.72
        else:
            th0 = rng.entre(16, 26) * DEG
            elev = rng.entre(*v['ouverture']) * DEG
            f_arret, r_rel = rng.entre(0.80, 0.88), rng.entre(0.60, 0.68)
        u = Vector((math.cos(phi) * math.cos(elev), math.sin(phi) * math.cos(elev), math.sin(elev)))
        cible = h.point_surface(u, f_arret)
        ond = ondulation(rng, 0.10)
        s_dep = fut.L * z0 / h_sommet
        p = fut.position(s_dep)
        d = Vector((math.sin(th0) * math.cos(phi), math.sin(th0) * math.sin(phi), math.cos(th0)))
        pts = [p.copy()]
        s = 0.0
        pas = 0.12
        tour = rng.entre(1.6, 2.4)  # longueur sur laquelle le guidage monte en puissance
        while s < 10.0:
            vise = cible - p
            if vise.length < 0.2:
                break
            k = 2.2 * lisse(0.3, tour, s)
            d = (d + (vise.normalized() - d) * (k * pas) + ond(s) * pas).normalized()
            p = p + d * pas
            s += pas
            pts.append(p.copy())
        r0 = profil_fut(s_dep) * r_rel
        b = arbre.ajouter(Branche(1, pts, r0, 0.018, k=0.85, parent=fut, s_parent=s_dep))
        b.u0, b.v0 = rng.entre(0, 1.5), rng.entre(0, 1.5)
        charpentieres.append(b)

    # Points déjà occupés (pour répartir les branches dans les vides du houppier).
    occupes = []
    for c in charpentieres:
        s = 0.0
        while s < c.L:
            q = c.position(s)
            if h.fraction(q) < 1.0:
                occupes.append(q)
            s += 0.6
        occupes.append(c.bout)

    # — Branches secondaires (niveau 2) sur les charpentières, dans le houppier. L'espacement s'élargit
    # si le houppier est grand, pour tenir le budget de triangles (au plus MAX_BRANCHES créneaux).
    entrees = {}
    for c in charpentieres:
        t = 1.0
        while t < c.L and h.fraction(c.position(t)) >= 0.97:
            t += 0.1
        entrees[id(c)] = t

    def creneaux_branches(e):
        cr = []
        for c in charpentieres:
            s = entrees[id(c)] + rng.entre(0.0, 0.3)
            while s < c.L * 0.93:
                cr.append((c, s))
                s += rng.entre(0.42, 0.68) * e
        return cr

    e = 1.0
    creneaux = creneaux_branches(e)
    while len(creneaux) > MAX_BRANCHES:
        e *= len(creneaux) / MAX_BRANCHES
        creneaux = creneaux_branches(e)
    rng.shuffle(creneaux)
    creneaux.sort(key=lambda cs: cs[1] / cs[0].L + rng.entre(0, 0.15))
    branches = []
    for c, s in creneaux:
        p0 = c.position(s)
        t0 = c.tangente(s)
        n0 = perpendiculaire(t0)
        b0 = t0.cross(n0)
        hrel = min(1.0, max(0.0, (p0.z - (h.c.z - h.bb)) / (h.bb + h.bh)))
        meilleur = None
        for _ in range(8):
            psi = rng.entre(0, 2 * math.pi)
            beta = rng.entre(30, 58) * DEG
            perp = n0 * math.cos(psi) + b0 * math.sin(psi)
            d0 = tourner_vers(t0, perp, beta)
            # Élévation visée : les branches hautes montent, les basses s'arquent puis retombent un peu.
            elev0 = (14 + 46 * hrel + rng.entre(-8, 12)) * DEG
            chute = (1.0 - hrel) * rng.entre(12, 34) * DEG
            f_arret = rng.entre(0.84, 0.92)
            ond = ondulation(rng, 0.35)
            alea = rng.random()
            if d0.z < -0.45:
                continue

            def cible(p, d, s_, elev0=elev0, chute=chute, d0=d0):
                elev = elev0 - chute * min(1.0, s_ / 2.5)
                o = h.exterieur_horizontal(p, d0)
                return (o * math.cos(elev) + HAUT * math.sin(elev)).normalized()

            pts = pousser(p0, d0, h, f_arret, 3.8, cible, 0.7, ond, 0.12)
            if len(pts) < 7:
                continue
            bout = pts[-1]
            o = h.exterieur_horizontal(p0, t0)
            dh = Vector((d0.x, d0.y, 0))
            ext = dh.normalized().dot(o) if dh.length > 1e-3 else 0.0
            score = min(distance_min(bout, occupes), 2.0) + 0.45 * ext + 0.3 * alea
            if meilleur is None or score > meilleur[0]:
                meilleur = (score, pts)
        if meilleur is None:
            continue
        pts = meilleur[1]
        if distance_min(pts[-1], occupes) < 0.35:
            continue
        r0 = min(0.55 * c.rayon(s), 0.075)
        b = arbre.ajouter(Branche(2, pts, r0, 0.009, k=1.0, parent=c, s_parent=s))
        b.u0, b.v0 = rng.entre(0, 1.5), rng.entre(0, 1.5)
        branches.append(b)
        occupes.append(b.bout)
        occupes.append(b.position(b.L * 0.6))

    # — Rameaux (niveau 3) sur les branches et le haut des charpentières (au plus MAX_RAMEAUX créneaux).
    def creneaux_rameaux(e):
        cr = []
        for b in branches:
            s = max(0.25, 0.18 * b.L) + rng.entre(0, 0.15)
            while s < b.L * 0.97:
                cr.append((b, s))
                s += rng.entre(0.26, 0.4) * e
        for c in charpentieres:
            s = 0.4 * c.L
            while s < c.L * 0.97:
                if h.fraction(c.position(s)) < 1.0:
                    cr.append((c, s))
                s += rng.entre(0.3, 0.45) * e
        return cr

    e = 1.0
    creneaux = creneaux_rameaux(e)
    while len(creneaux) > MAX_RAMEAUX:
        e *= len(creneaux) / MAX_RAMEAUX
        creneaux = creneaux_rameaux(e)
    rng.shuffle(creneaux)
    occ3 = [b.bout for b in branches] + [c.bout for c in charpentieres]
    rameaux = []
    for par, s in creneaux:
        p0 = par.position(s)
        t0 = par.tangente(s)
        n0 = perpendiculaire(t0)
        b0 = t0.cross(n0)
        meilleur = None
        for _ in range(6):
            psi = rng.entre(0, 2 * math.pi)
            beta = rng.entre(25, 55) * DEG
            d0 = tourner_vers(t0, n0 * math.cos(psi) + b0 * math.sin(psi), beta)
            lmax = rng.entre(0.5, 1.0)
            ond = ondulation(rng, 0.4)
            alea = rng.random()

            def cible(p, d, s_, t0=t0):
                return (t0 * 0.5 + h.normale(p) * 0.5 + HAUT * 0.1).normalized()

            pts = pousser(p0, d0, h, 0.97, lmax, cible, 0.5, ond, 0.08)
            if len(pts) < 5:
                continue
            bout = pts[-1]
            ext = d0.dot(h.normale(p0))
            prof = h.fraction(bout)
            score = min(distance_min(bout, occ3), 1.5) + 0.4 * ext + 0.35 * min(prof, 1.0) + 0.25 * alea
            if meilleur is None or score > meilleur[0]:
                meilleur = (score, pts)
        if meilleur is None:
            continue
        pts = meilleur[1]
        if distance_min(pts[-1], occ3) < 0.25:
            continue
        r0 = min(0.55 * par.rayon(s), 0.022)
        r = arbre.ajouter(Branche(3, pts, r0, 0.005, k=1.0, parent=par, s_parent=s))
        r.u0, r.v0 = rng.entre(0, 1.5), rng.entre(0, 1.5)
        rameaux.append(r)
        occ3.append(r.bout)

    # Ordre parent → enfants garanti par construction (fût, charpentières, branches, rameaux).
    arbre.graine = v['graine']
    return arbre


# ——————————————————————————————————————————————————————————————— Maillage

class Constructeur:
    def __init__(self):
        self.v = []
        self.f = []
        self.uv = []  # une liste d'UV par face (par coin)
        self.n = []  # normales personnalisées par sommet (cartes)

    def tube(self, ech, cotes, u0, v0, modulation=None):
        """ech : [(position, tangente, rayon, s)] ; le dernier échantillon est la pointe (un sommet)."""
        # Repères par transport parallèle (pas de torsion des anneaux).
        t = ech[0][1]
        nrm = perpendiculaire(t)
        anneaux = []
        for i, (p, ti, r, s) in enumerate(ech[:-1]):
            if i > 0:
                q = ech[i - 1][1].rotation_difference(ti)
                nrm = q @ nrm
                nrm = (nrm - ti * nrm.dot(ti)).normalized()
            bi = ti.cross(nrm)
            idx = []
            for k in range(cotes):
                th = 2 * math.pi * k / cotes
                rr = r * (modulation(th, s) if modulation else 1.0)
                idx.append(len(self.v))
                self.v.append(p + (nrm * math.cos(th) + bi * math.sin(th)) * rr)
            anneaux.append((idx, r, s))
        pointe = len(self.v)
        self.v.append(ech[-1][0].copy())
        s_pointe = ech[-1][3]

        perimetre = 2 * cotes * math.sin(math.pi / cotes)  # périmètre du polygone de rayon 1

        def u(k, r):  # abscisse en mètres sur la circonférence réelle du tube
            return (k / cotes - 0.5) * perimetre * r + u0

        for i in range(len(anneaux) - 1):
            (a, ra, sa), (b, rb, sb) = anneaux[i], anneaux[i + 1]
            for k in range(cotes):
                k1 = (k + 1) % cotes
                self.f.append((a[k], a[k1], b[k1], b[k]))
                self.uv.append(((u(k, ra), sa + v0), (u(k + 1, ra), sa + v0),
                                (u(k + 1, rb), sb + v0), (u(k, rb), sb + v0)))
        a, ra, sa = anneaux[-1]
        for k in range(cotes):
            k1 = (k + 1) % cotes
            self.f.append((a[k], a[k1], pointe))
            self.uv.append(((u(k, ra), sa + v0), (u(k + 1, ra), sa + v0), (u(k + 0.5, ra), s_pointe + v0)))

    def carte(self, A, V, S, w, hgt, normale_fn):
        bas = A - S * (w / 2) - V * (hgt * PIED_TIGE)
        coins = [bas, bas + S * w, bas + S * w + V * hgt, bas + V * hgt]
        i0 = len(self.v)
        for c in coins:
            self.v.append(c)
            self.n.append(normale_fn(c))
        self.f.append((i0, i0 + 1, i0 + 2, i0 + 3))
        self.uv.append(((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)))

    def triangles(self):
        return sum(len(f) - 2 for f in self.f)


def echantillons_niveau(arbre, cfg):
    """Rééchantillonne chaque branche pour le niveau de détail. Le départ de chaque branche est recalé
    sur la polyligne grossière de sa mère (avec atténuation le long de la branche) pour que la base reste
    noyée dans la mère même quand celle-ci n'a que quelques segments."""
    grossier = {}  # id(branche) -> (liste s, liste positions)
    ech = {}
    for b in arbre.branches:
        if b.niveau == 3 and not cfg['rameaux']:
            continue
        if b.niveau == 0:
            # Anneaux explicites : serrés en bas (empattement), puis autour de la fourche.
            liste = [s for s in cfg['fut'] if s < b.hf - 0.3]
            if cfg['rameaux']:
                liste += [b.hf - 0.1, b.hf + 0.25, b.L - 0.15, b.L]
            else:
                liste += [b.hf, b.L - 0.2, b.L]
            liste = sorted(set(round(s, 4) for s in liste))
            delta = Vector((0, 0, 0))
            l_att = 1.0
        else:
            nseg = max(cfg['segments_min'][b.niveau], round(b.L / cfg['segment'][b.niveau]))
            liste = [b.L * i / nseg for i in range(nseg + 1)]
            ss, pp = grossier[id(b.parent)]
            j = max(1, min(len(ss) - 1, bisect.bisect_left(ss, b.s_parent)))
            t = 0.0 if ss[j] <= ss[j - 1] else (b.s_parent - ss[j - 1]) / (ss[j] - ss[j - 1])
            t = min(1.0, max(0.0, t))
            delta = pp[j - 1].lerp(pp[j], t) - b.pts[0]
            l_att = min(1.2, 0.6 * b.L)
        pos = []
        for s in liste:
            att = max(0.0, 1.0 - s / l_att) ** 2 if b.niveau else 0.0
            pos.append(b.position(s) + delta * att)
        grossier[id(b)] = (liste, pos)
        tang = []
        for i in range(len(pos)):
            a = pos[max(0, i - 1)]
            c = pos[min(len(pos) - 1, i + 1)]
            tang.append(HAUT.copy() if b.niveau == 0 else (c - a).normalized())
        ech[id(b)] = [(pos[i], tang[i], b.rayon(liste[i]), liste[i]) for i in range(len(pos))]
    return ech, grossier


def construire_bois(arbre, cfg):
    ech, grossier = echantillons_niveau(arbre, cfg)
    k = Constructeur()
    for b in arbre.branches:
        if id(b) not in ech:
            continue
        mod = None
        if b.niveau == 0:
            l1, l2, l3 = b.lobes

            def mod(th, s, l1=l1, l2=l2, l3=l3):
                # Contreforts racinaires à la base, légère ovalisation sur toute la hauteur.
                return (1.0 + math.exp(-s / 0.25) * (0.09 * math.cos(5 * th + l1) + 0.05 * math.cos(3 * th + l2))
                        + 0.02 * math.cos(2 * th + l3))
        k.tube(ech[id(b)], cfg['cotes'][b.niveau], b.u0, b.v0, mod)
    return k, grossier


def orienter_carte(rng, g, o, sortie, desordre):
    """V : de la tige vers le bout du rameau ; N : face de la carte.
    La face regarde vers l'extérieur du houppier, avec un fort désordre (sinon, au bord de la silhouette,
    toutes les cartes seraient vues par la tranche) ; le rameau suit sa branche, projeté dans le plan de
    la carte, s'écarte un peu vers l'extérieur et retombe légèrement."""
    N = (o + rng.direction() * desordre).normalized()
    if N.dot(o) < 0.15:
        N = (N + o * (0.15 - N.dot(o) + 0.05)).normalized()
    if abs(N.z) > 0.7:  # pas de carte presque horizontale (lame vue par la tranche à hauteur d'homme)
        hz = Vector((N.x, N.y, 0.0))
        if hz.length < 1e-3:
            hz = Vector((o.x, o.y, 0.0)) if math.hypot(o.x, o.y) > 1e-3 else Vector((1, 0, 0))
        N = (hz.normalized() * math.sqrt(1 - 0.49) + Vector((0, 0, math.copysign(0.7, N.z)))).normalized()
    gt = g - o * g.dot(o)
    if gt.length < 1e-3:
        gt = perpendiculaire(o)
    gt.normalize()
    V = gt * (1.0 - sortie) + o * sortie + rng.direction() * 0.3 + Vector((0, 0, -0.18))
    V = V - N * V.dot(N)
    if V.length < 0.2:
        V = perpendiculaire(N)
    V.normalize()
    if V.dot(o) > 0.35:  # le rameau ne pointe pas trop hors du houppier (pas de pointes sur la silhouette)
        V = V - o * (V.dot(o) - 0.35)
        V = (V - N * V.dot(N)).normalized()
    S = V.cross(N)
    return V, N, S


def selection_eloignee(candidats, obligatoires, budget):
    """Échantillonnage du point le plus éloigné (sur les centres de cartes) : répartition homogène."""
    choisis = list(obligatoires)
    if len(choisis) > budget:
        reste = choisis
        choisis = [reste[0]]
        candidats = reste[1:]
    else:
        candidats = list(candidats)
    dist = [distance_min(c['centre'], [x['centre'] for x in choisis], 50.0) for c in candidats]
    while len(choisis) < budget and candidats:
        i = max(range(len(candidats)), key=lambda j: dist[j])
        c = candidats.pop(i)
        dist.pop(i)
        choisis.append(c)
        for j, cand in enumerate(candidats):
            d = (cand['centre'] - c['centre']).length
            if d < dist[j]:
                dist[j] = d
    return choisis


def construire_feuillage(arbre, cfg, grossier, nom_niveau):
    h = arbre.houppier
    rng = Alea(arbre.graine * 7919 + hash_stable(nom_niveau))
    tmin, tmax = cfg['taille']
    obligatoires, options = [], []

    def candidat(A, g, liste, taille_rel=1.0):
        # Référence d'orientation : normale du houppier aplatie verticalement, pour que les cartes du
        # dessus et du dessous restent lisibles de côté (pas de lames horizontales vues par la tranche).
        n = h.normale(A)
        o = Vector((n.x, n.y, n.z * 0.55)).normalized()
        taille = rng.entre(tmin, tmax) * taille_rel
        # Plusieurs tirages : on garde le premier dont les coins ne sortent pas trop de l'enveloppe
        # (silhouette sans pointes), sinon celui qui en sort le moins.
        meilleur = None
        for _ in range(5):
            V, N, S = orienter_carte(rng, g, o, cfg['sortie'], cfg['desordre'])
            bas = A - S * (taille / 2) - V * (taille * PIED_TIGE)
            coins = (bas + S * taille + V * taille, bas + V * taille, bas, bas + S * taille)
            f = max(h.fraction(c) for c in coins)
            if meilleur is None or f < meilleur[0]:
                meilleur = (f, V, S)
            if f <= cfg['debord']:
                break
        _, V, S = meilleur
        liste.append(dict(A=A, V=V, S=S, taille=taille, centre=A + V * (taille / 2)))

    def pos_grossiere(b, s):
        ss, pp = grossier[id(b)]
        j = max(1, min(len(ss) - 1, bisect.bisect_left(ss, s)))
        t = 0.0 if ss[j] <= ss[j - 1] else min(1.0, max(0.0, (s - ss[j - 1]) / (ss[j] - ss[j - 1])))
        return pp[j - 1].lerp(pp[j], t)

    for b in arbre.branches:
        if b.niveau == 0:
            continue
        if b.niveau in (1, 2):
            # Bout de charpentière ou de branche : toujours une carte.
            candidat(pos_grossiere(b, b.L * 0.98), b.tangente(b.L), obligatoires)
            if b.niveau == 2:
                s = b.L * 0.72
                candidat(pos_grossiere(b, s), b.tangente(s), options)
        elif cfg['rameaux']:
            candidat(pos_grossiere(b, b.L * 0.97), b.tangente(b.L), obligatoires)
            candidat(pos_grossiere(b, b.L * 0.97), b.tangente(b.L), options)
            s = b.L * 0.55
            candidat(pos_grossiere(b, s), b.tangente(s), options)
        else:
            # Niveau bas : pas de rameaux maillés ; la carte part de la branche, à la base du rameau,
            # dans la direction du rameau (plus grande pour couvrir son étendue).
            A = pos_grossiere(b.parent, b.s_parent)
            g = (b.bout - b.pts[0]).normalized()
            candidat(A, g, options)

    # Cartes de comblement : pour chaque point de l'enveloppe, une carte attachée au bois maillé le plus
    # proche et dirigée vers ce point. La sélection du point le plus éloigné les retient là où le
    # houppier serait clairsemé.
    bois = []
    for b in arbre.branches:
        if b.niveau == 0 or id(b) not in grossier:
            continue
        s = 0.3
        while s < b.L:
            q = pos_grossiere(b, s)
            if h.fraction(q) < 1.0:
                bois.append((q, b, s))
            s += 0.25
    n = 360
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        if z < -0.55:
            continue
        r = math.sqrt(1 - z * z)
        a = i * math.pi * (3 - math.sqrt(5))
        P = h.point_surface(Vector((r * math.cos(a), r * math.sin(a), z)), 0.86)
        meilleur = min(bois, key=lambda w: (w[0] - P).length_squared)
        d = (P - meilleur[0]).length
        if 0.15 < d < 1.4:
            candidat(meilleur[0], (P - meilleur[0]) / d, options)

    cartes = selection_eloignee(options, obligatoires, cfg['cartes'])
    k = Constructeur()
    for c in cartes:
        k.carte(c['A'], c['V'], c['S'], c['taille'], c['taille'], h.normale)
    return k, cartes


def hash_stable(texte):
    hsh = 2166136261
    for ch in texte.encode('utf-8'):
        hsh = ((hsh ^ ch) * 16777619) & 0xFFFFFFFF
    return hsh


def couverture(h, centres):
    """Indicateur de trous : distance du point de l'enveloppe le plus éloigné de toute carte."""
    n = 600
    d = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * math.pi * (3 - math.sqrt(5))
        u = Vector((r * math.cos(a), r * math.sin(a), z))
        if u.z < -0.6:
            continue  # dessous du houppier : volontairement ouvert (on voit la charpente)
        p = h.point_surface(u, 0.95)
        d.append(distance_min(p, centres, 10.0))
    d.sort()
    return d[len(d) // 2], d[int(len(d) * 0.95)], d[-1]


# ——————————————————————————————————————————————————————————————— Matériaux

def charger_image(chemin, couleur=True):
    img = bpy.data.images.load(str(chemin), check_existing=True)
    img.colorspace_settings.name = 'sRGB' if couleur else 'Non-Color'
    return img


def materiau_ecorce():
    m = bpy.data.materials.new('ecorce')
    m.use_nodes = True
    m.use_backface_culling = True  # tubes fermés : simple face
    nt = m.node_tree
    nt.nodes.clear()
    sortie = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapp = nt.nodes.new('ShaderNodeMapping')
    mapp.inputs['Scale'].default_value = (1 / TAILLE_TEXTURE_ECORCE, 1 / TAILLE_TEXTURE_ECORCE, 1)
    nt.links.new(coord.outputs['UV'], mapp.inputs['Vector'])
    d = DOSSIER_TEXTURES / 'bark_platanus' / 'haute'
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = charger_image(d / 'couleur.webp')
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = charger_image(d / 'normale.webp', False)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = charger_image(d / 'arm.webp', False)
    for t in (tc, tn, ta):
        nt.links.new(mapp.outputs['Vector'], t.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 1.3
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(ta.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])  # ARM : R = occlusion, G = rugosité, B = métal
    nt.links.new(tn.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], sortie.inputs['Surface'])
    return m


def materiau_feuillage():
    m = bpy.data.materials.new('feuillage')
    m.use_nodes = True
    m.use_backface_culling = False  # double face (doubleSided dans le glTF)
    m.surface_render_method = 'DITHERED'
    nt = m.node_tree
    nt.nodes.clear()
    sortie = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = charger_image(DOSSIER_TEXTURES / 'feuillage' / 'haute' / 'rameau.webp')
    tex.image.alpha_mode = 'STRAIGHT'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (*couleur_lineaire(TEINTE_FEUILLAGE), 1.0)
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    # Découpe alpha (alpha clip) : alpha = 1 − (alpha < seuil), motif reconnu par l'exportateur glTF (MASK).
    inf = nt.nodes.new('ShaderNodeMath')
    inf.operation = 'LESS_THAN'
    inf.inputs[1].default_value = SEUIL_ALPHA
    sous = nt.nodes.new('ShaderNodeMath')
    sous.operation = 'SUBTRACT'
    sous.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs['Alpha'], inf.inputs[0])
    nt.links.new(inf.outputs['Value'], sous.inputs[1])
    nt.links.new(sous.outputs['Value'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.65
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], sortie.inputs['Surface'])
    return m


# ——————————————————————————————————————————————————————————————— Objets Blender

def creer_objet(nom, k, materiau, collection, normales=False):
    me = bpy.data.meshes.new(nom)
    me.from_pydata([tuple(p) for p in k.v], [], k.f)
    me.validate(clean_customdata=False)
    uvl = me.uv_layers.new(name='UVMap')
    plat = [x for coins in k.uv for uv in coins for x in uv]
    uvl.data.foreach_set('uv', plat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    if normales:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in k.n])
    me.materials.append(materiau)
    me.update()
    ob = bpy.data.objects.new(nom, me)
    collection.objects.link(ob)
    return ob


def bornes(objets):
    mn = Vector((1e9, 1e9, 1e9))
    mx = -mn
    for o in objets:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            mn = Vector(map(min, mn, p))
            mx = Vector(map(max, mx, p))
    return mn, mx


# ——————————————————————————————————————————————————————————————— Export et vérification GLB

OPTIONS_EXPORT = dict(
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials='EXPORT',
    export_image_format='NONE',
    export_vertex_color='NONE',
    export_attributes=False,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    export_draco_mesh_compression_enable=False,
)


def exporter(objets, chemin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objets[0]
    bpy.ops.export_scene.gltf(filepath=str(chemin), **OPTIONS_EXPORT)


def lire_glb(chemin):
    data = Path(chemin).read_bytes()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'en-tête GLB invalide'
    off = 12
    js, binaire = None, b''
    while off < len(data):
        lg, typ = struct.unpack_from('<II', data, off)
        bloc = data[off + 8: off + 8 + lg]
        if typ == 0x4E4F534A:
            js = json.loads(bloc.decode('utf-8'))
        elif typ == 0x004E4942:
            binaire = bloc
        off += 8 + lg
    return js, binaire


def lire_accesseur(js, binaire, i):
    acc = js['accessors'][i]
    vue = js['bufferViews'][acc['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    fmt = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[acc['componentType']]
    taille = struct.calcsize(fmt)
    pas = vue.get('byteStride', taille * n)
    base = vue.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * n, binaire, base + j * pas) for j in range(acc['count'])]


def verifier_glb(chemin, houppier):
    js, binaire = lire_glb(chemin)
    rapport = {'fichier': Path(chemin).name, 'octets': Path(chemin).stat().st_size, 'primitives': []}
    noms_mat = [m.get('name') for m in js.get('materials', [])]
    rapport['materiaux'] = {m.get('name'): {'alphaMode': m.get('alphaMode', 'OPAQUE'),
                                            'alphaCutoff': m.get('alphaCutoff'),
                                            'doubleSided': m.get('doubleSided', False)}
                            for m in js.get('materials', [])}
    rapport['images'] = len(js.get('images', []))
    rapport['textures'] = len(js.get('textures', []))
    rapport['cameras'] = len(js.get('cameras', []))
    rapport['lumieres'] = 'KHR_lights_punctual' in json.dumps(js.get('extensions', {}))
    rapport['noeuds'] = [(n.get('name'), {k: n[k] for k in ('translation', 'rotation', 'scale', 'matrix') if k in n})
                         for n in js.get('nodes', [])]
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            mat = noms_mat[prim['material']] if 'material' in prim else None
            pos = js['accessors'][prim['attributes']['POSITION']]
            tri = js['accessors'][prim['indices']]['count'] // 3
            mn = [min(a, b) for a, b in zip(mn, pos['min'])]
            mx = [max(a, b) for a, b in zip(mx, pos['max'])]
            info = {'maillage': mesh.get('name'), 'materiau': mat, 'triangles': tri,
                    'sommets': pos['count'], 'attributs': sorted(prim['attributes'].keys())}
            UV = lire_accesseur(js, binaire, prim['attributes']['TEXCOORD_0'])
            info['uv_min'] = [round(min(t[i] for t in UV), 3) for i in (0, 1)]
            info['uv_max'] = [round(max(t[i] for t in UV), 3) for i in (0, 1)]
            if mat == 'ecorce':
                # Échelle des UV : aire UV / aire 3D ≈ 1 si 1 unité UV = 1 m.
                P = lire_accesseur(js, binaire, prim['attributes']['POSITION'])
                I = lire_accesseur(js, binaire, prim['indices'])
                a3 = auv = 0.0
                for j in range(0, len(I), 3):
                    i0, i1, i2 = I[j][0], I[j + 1][0], I[j + 2][0]
                    p0, p1, p2 = (Vector(P[i0]), Vector(P[i1]), Vector(P[i2]))
                    a3 += (p1 - p0).cross(p2 - p0).length / 2
                    u0, u1, u2 = UV[i0], UV[i1], UV[i2]
                    auv += abs((u1[0] - u0[0]) * (u2[1] - u0[1]) - (u2[0] - u0[0]) * (u1[1] - u0[1])) / 2
                info['aire_uv_sur_aire_m2'] = round(auv / a3, 3)
            if mat == 'feuillage':
                # Normales personnalisées : comparer à la normale du houppier (glTF Y haut -> Blender Z haut).
                P = lire_accesseur(js, binaire, prim['attributes']['POSITION'])
                N = lire_accesseur(js, binaire, prim['attributes']['NORMAL'])
                tot = 0.0
                for p, nn in zip(P, N):
                    attendu = houppier.normale(Vector((p[0], -p[2], p[1])))
                    tot += attendu.dot(Vector((nn[0], -nn[2], nn[1])))
                info['accord_normales_houppier'] = round(tot / len(P), 4)
            rapport['primitives'].append(info)
    rapport['bornes_min_gltf'] = [round(x, 3) for x in mn]
    rapport['bornes_max_gltf'] = [round(x, 3) for x in mx]
    rapport['hauteur'] = round(mx[1] - mn[1], 3)
    rapport['largeur_x'] = round(mx[0] - mn[0], 3)
    rapport['largeur_z'] = round(mx[2] - mn[2], 3)
    return rapport


# ——————————————————————————————————————————————————————————————— Aperçus (Cycles CPU)

def normales_double_face_apercu():
    """Aperçu seulement (après export et enregistrement) : Cycles retourne la normale des faces arrière ;
    on la remet dans le sens de la normale personnalisée (vers l'extérieur du houppier) pour que les deux
    faces d'une carte soient éclairées pareil, comme un matériau sans « éclairage double face »."""
    m = bpy.data.materials['feuillage']
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    signe = nt.nodes.new('ShaderNodeMath')
    signe.operation = 'MULTIPLY_ADD'
    signe.inputs[1].default_value = -2.0
    signe.inputs[2].default_value = 1.0
    echelle = nt.nodes.new('ShaderNodeVectorMath')
    echelle.operation = 'SCALE'
    nt.links.new(geo.outputs['Backfacing'], signe.inputs[0])
    nt.links.new(geo.outputs['Normal'], echelle.inputs['Vector'])
    nt.links.new(signe.outputs['Value'], echelle.inputs['Scale'])
    nt.links.new(echelle.outputs['Vector'], bsdf.inputs['Normal'])
    # Cycles traite la carte comme opaque : une carte dont la face visible est à l'opposé du soleil
    # serait noire, alors que PlayCanvas (sans éclairage double face) l'éclaire d'après sa normale.
    # Un peu de translucidité (comme une vraie feuille) rapproche l'aperçu du rendu du jeu.
    sortie = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    trans = nt.nodes.new('ShaderNodeBsdfTranslucent')
    mix_col = next(n for n in nt.nodes if n.type == 'MIX')
    nt.links.new(mix_col.outputs['Result'], trans.inputs['Color'])
    melange = nt.nodes.new('ShaderNodeMixShader')
    melange.inputs['Fac'].default_value = 0.3
    nt.links.new(bsdf.outputs['BSDF'], melange.inputs[1])
    nt.links.new(trans.outputs['BSDF'], melange.inputs[2])
    alpha = nt.nodes.new('ShaderNodeMixShader')
    transp = nt.nodes.new('ShaderNodeBsdfTransparent')
    sous = next(n for n in nt.nodes if n.type == 'MATH' and n.operation == 'SUBTRACT')
    nt.links.new(sous.outputs['Value'], alpha.inputs['Fac'])
    nt.links.new(transp.outputs['BSDF'], alpha.inputs[1])
    nt.links.new(melange.outputs['Shader'], alpha.inputs[2])
    nt.links.new(alpha.outputs['Shader'], sortie.inputs['Surface'])


def scene_apercu():
    sc = bpy.context.scene
    normales_double_face_apercu()
    col = bpy.data.collections.new('apercu')
    sc.collection.children.link(col)
    # Sol de pierre claire.
    me = bpy.data.meshes.new('sol')
    t = 150.0
    me.from_pydata([(-t, -t, 0), (t, -t, 0), (t, t, 0), (-t, t, 0)], [], [(0, 1, 2, 3)])
    sol = bpy.data.objects.new('sol', me)
    ms = bpy.data.materials.new('sol')
    ms.use_nodes = True
    b = ms.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.36, 0.33, 0.29, 1)
    b.inputs['Roughness'].default_value = 0.9
    me.materials.append(ms)
    col.objects.link(sol)
    # Ciel : dégradé horizon clair → zénith bleu.
    w = bpy.data.worlds.new('ciel')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    co = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.62, 0.70, 0.80, 1)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (0.22, 0.38, 0.72, 1)
    fond = nt.nodes.new('ShaderNodeBackground')
    fond.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(co.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], fond.inputs['Color'])
    nt.links.new(fond.outputs['Background'], out.inputs['Surface'])
    sc.world = w
    # Soleil d'après-midi, de trois quarts avant.
    ls = bpy.data.lights.new('soleil', 'SUN')
    ls.energy = 4.0
    ls.color = (1.0, 0.95, 0.88)
    ls.angle = 1.0 * DEG
    so = bpy.data.objects.new('soleil', ls)
    el, az = 52 * DEG, -125 * DEG
    L = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    so.rotation_mode = 'QUATERNION'
    so.rotation_quaternion = L.to_track_quat('Z', 'Y')
    col.objects.link(so)
    # Caméra à hauteur d'homme, à 15 m du tronc.
    cd = bpy.data.cameras.new('camera')
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = 50 * DEG
    cam = bpy.data.objects.new('camera', cd)
    cam.location = (0.0, -15.0, 1.7)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (Vector((0, 0, 5.4)) - cam.location).to_track_quat('-Z', 'Y')
    col.objects.link(cam)
    sc.camera = cam
    r = sc.render
    r.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 48
    sc.view_settings.view_transform = 'AgX'
    r.image_settings.file_format = 'PNG'
    return cam


def rendre(chemin, visibles, tous, echantillons, largeur, hauteur):
    sc = bpy.context.scene
    for o in tous:
        o.hide_render = o not in visibles
    sc.cycles.samples = echantillons
    sc.render.resolution_x = largeur
    sc.render.resolution_y = hauteur
    sc.render.resolution_percentage = 100
    sc.render.filepath = str(chemin)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'  rendu {Path(chemin).name} en {time.time() - t:.1f} s')


def assembler(chemins, sortie, marge=8):
    import numpy as np
    imgs = []
    for c in chemins:
        im = bpy.data.images.load(str(c))
        w, h = im.size
        a = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(h, w, 4))
    h = max(i.shape[0] for i in imgs)
    blanc = np.ones((h, marge, 4), dtype=np.float32)
    parts = []
    for i, a in enumerate(imgs):
        if i:
            parts.append(blanc)
        parts.append(a)
    tout = np.concatenate(parts, axis=1)
    out = bpy.data.images.new(Path(sortie).stem, tout.shape[1], tout.shape[0], alpha=False)
    out.pixels.foreach_set(tout.ravel())
    out.filepath_raw = str(sortie)
    out.file_format = 'PNG'
    out.save()


# ——————————————————————————————————————————————————————————————— Programme principal

def arguments():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'apercu': None, 'echantillons': 48, 'echelle': 1.0, 'variantes': list(VARIANTES)}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--apercu':
            opts['apercu'] = Path(argv[i + 1])
            i += 1
        elif a == '--echantillons':
            opts['echantillons'] = int(argv[i + 1])
            i += 1
        elif a == '--echelle':
            opts['echelle'] = float(argv[i + 1])
            i += 1
        elif a == '--variantes':
            opts['variantes'] = argv[i + 1].split(',')
            i += 1
        i += 1
    return opts


def main():
    opts = arguments()
    t0 = time.time()
    # Scène vide (le démarrage d'usine contient un cube, une caméra et une lampe).
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    bpy.data.orphans_purge(do_recursive=True)  # maillage et matériau du cube d'usine
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0

    mat_bois = materiau_ecorce()
    mat_feuilles = materiau_feuillage()
    DOSSIER_MODELES.mkdir(parents=True, exist_ok=True)
    FICHIER_BLEND.parent.mkdir(parents=True, exist_ok=True)

    resultats = {}
    objets_par_cle = {}
    for nv in opts['variantes']:
        v = VARIANTES[nv]
        arbre = generer_squelette(f'platane-{nv}', v)
        stats = {n: len(arbre.niveau(n)) for n in range(4)}
        print(f'platane-{nv} : branches par niveau {stats}')
        for nom_niv, cfg in NIVEAUX.items():
            cle = f'platane-{nv}-{nom_niv}'
            cfg = dict(cfg)
            cfg['segment'] = dict(cfg['segment'])
            # Respect du budget de triangles du bois : allonger les segments si nécessaire.
            for _ in range(12):
                k_bois, grossier = construire_bois(arbre, cfg)
                if k_bois.triangles() <= cfg['triangles_max']:
                    break
                cfg['segment'] = {n: s * 1.15 for n, s in cfg['segment'].items()}
            assert k_bois.triangles() <= cfg['triangles_max'], f'{cle} : budget bois dépassé'
            k_f, cartes = construire_feuillage(arbre, cfg, grossier, nom_niv)
            col = bpy.data.collections.new(cle)
            sc.collection.children.link(col)
            ob_b = creer_objet(f'{cle}-bois', k_bois, mat_bois, col)
            ob_f = creer_objet(f'{cle}-feuillage', k_f, mat_feuilles, col, normales=True)
            objets_par_cle[cle] = (ob_b, ob_f)
            mn, mx = bornes([ob_b, ob_f])
            bn, bx = bornes([ob_b])
            cov = couverture(arbre.houppier, [c['centre'] for c in cartes])
            print(f'  {cle} : bois {k_bois.triangles()} tri, {len(cartes)} cartes ({k_f.triangles()} tri), '
                  f'hauteur {mx.z - mn.z:.2f} m, largeur {mx.x - mn.x:.2f} × {mx.y - mn.y:.2f} m, '
                  f'trous (médiane/95 %/max) {cov[0]:.2f}/{cov[1]:.2f}/{cov[2]:.2f} m ; '
                  f'bois {bx.x - bn.x:.2f} × {bx.y - bn.y:.2f} × {bx.z:.2f} m')
            chemin = DOSSIER_MODELES / f'{cle}.glb'
            exporter([ob_b, ob_f], chemin)
            resultats[cle] = verifier_glb(chemin, arbre.houppier)

    print('\n=== Vérification des GLB (relecture du JSON et des tampons) ===')
    for cle, r in resultats.items():
        print(json.dumps(r, ensure_ascii=False))
        for p in r['primitives']:
            assert {'POSITION', 'NORMAL', 'TEXCOORD_0'} <= set(p['attributs']), f'{cle} : attribut manquant'
        assert set(r['materiaux']) == {'ecorce', 'feuillage'}, f'{cle} : matériaux {r["materiaux"]}'
        assert r['images'] == 0 and r['textures'] == 0 and r['cameras'] == 0 and not r['lumieres']

    # Fichier source : seule la variante a (haute) visible à l'ouverture ; textures en chemin relatif.
    for lc in sc.view_layers[0].layer_collection.children:
        lc.hide_viewport = lc.name != 'platane-a-haute'
    bpy.context.preferences.filepaths.save_version = 0  # pas de platanes.blend1
    bpy.ops.wm.save_as_mainfile(filepath=str(FICHIER_BLEND), relative_remap=True, compress=True)
    print('Enregistré', FICHIER_BLEND, [im.filepath for im in bpy.data.images if im.filepath])

    if opts['apercu']:
        d = opts['apercu']
        d.mkdir(parents=True, exist_ok=True)
        for lc in sc.view_layers[0].layer_collection.children:
            lc.hide_viewport = False
        scene_apercu()
        tous = [o for paire in objets_par_cle.values() for o in paire]
        L = int(800 * opts['echelle'])
        H = int(1000 * opts['echelle'])
        ech = opts['echantillons']
        for nv in opts['variantes']:
            haute = objets_par_cle[f'platane-{nv}-haute']
            basse = objets_par_cle[f'platane-{nv}-basse']
            rendre(d / f'platane-{nv}-haute.png', haute, tous, ech, L, H)
            rendre(d / f'platane-{nv}-basse.png', basse, tous, ech, L, H)
            rendre(d / f'platane-{nv}-bois.png', [haute[0]], tous, max(16, ech // 2), L, H)
            assembler([d / f'platane-{nv}-haute.png', d / f'platane-{nv}-basse.png'],
                      d / f'comparaison-{nv}-haute-basse.png')
        if len(opts['variantes']) > 1:
            assembler([d / f'platane-{nv}-haute.png' for nv in opts['variantes']], d / 'variantes-haute.png')
    print(f'Terminé en {time.time() - t0:.1f} s')


if __name__ == '__main__':
    main()
