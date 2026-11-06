# Kit de façade haussmannienne modulaire (travées de 3 m), généré par script.
# Exécution : /opt/blender/blender -b --factory-startup --python blender/scripts/facade.py
# Sorties   : public/ressources/modeles/facade-haute.glb, facade-basse.glb ; blender/sources/facade.blend
#
# Repère Blender : X = largeur de la travée (centrée), Z = hauteur, façade dans le plan Y = 0, face avant vers −Y
# (devient +Z dans le glTF). Unités : mètres. Proportions d'un immeuble haussmannien courant :
# rez-de-chaussée 4,6 m, étages 3,1 m, baies de 1,25 × 2,35 m, balcons filants aux 2e et 5e étages.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ICI = os.path.dirname(os.path.abspath(__file__))
PROJET = os.path.normpath(os.path.join(ICI, '..', '..'))
SORTIE = os.path.join(PROJET, 'public', 'ressources', 'modeles')
SOURCE = os.path.join(PROJET, 'blender', 'sources', 'facade.blend')

L = 3.0  # largeur d'une travée
H_RDC = 4.6
H_ETAGE = 3.1

# ——————————————————————————————————————————— Matériaux (aperçu Blender ; remplacés par nom dans PlayCanvas)
COULEURS = {
    'pierre': (0.78, 0.72, 0.62, 1),
    'corniche': (0.82, 0.77, 0.67, 1),
    'menuiserie': (0.86, 0.85, 0.80, 1),
    'vitre': (0.08, 0.11, 0.14, 1),
    'ferronnerie': (0.05, 0.05, 0.05, 1),
    'fonte': (0.06, 0.07, 0.07, 1),
    'devanture': (0.3, 0.25, 0.2, 1),
    'porte': (0.12, 0.2, 0.16, 1),
    'zinc': (0.45, 0.49, 0.52, 1),
    'toile': (0.55, 0.15, 0.12, 1),
}


def materiau(nom):
    m = bpy.data.materials.get(nom)
    if m:
        return m
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = COULEURS[nom]
    p.inputs['Roughness'].default_value = 0.15 if nom == 'vitre' else 0.6
    return m


# ——————————————————————————————————————————— Constructeur de maillage
class Piece:
    """Accumule des faces (avec matériau et UV) puis crée un objet Blender."""

    def __init__(self, nom):
        self.nom = nom
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.uv_unitaires = set()  # index de faces dont les UV sont fournis (0–1)

    def idx_mat(self, nom):
        if nom not in self.mats:
            self.mats.append(nom)
        return self.mats.index(nom)

    def quad(self, pts, mat, uv=None, n=None):
        """Face plane ; si n (normale attendue) est donnée, l'ordre des sommets est corrigé en conséquence."""
        if n is not None:
            a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[2])
            if (b - a).cross(c - a).dot(Vector(n)) < 0:
                pts = list(reversed(pts))
                uv = list(reversed(uv)) if uv else uv
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.idx_mat(mat)
        if uv:
            for loop, t in zip(f.loops, uv):
                loop[self.uv].uv = t
            self.uv_unitaires.add(f)
        return f

    def boite(self, x0, x1, y0, y1, z0, z1, mat, biseau=0.0, faces=('av', 'ar', 'g', 'd', 'h', 'b')):
        """Pavé aligné sur les axes ; biseau > 0 arrondit légèrement les arêtes (accroche la lumière)."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co.x = x0 if v.co.x < 0 else x1
            v.co.y = y0 if v.co.y < 0 else y1
            v.co.z = z0 if v.co.z < 0 else z1
        retirer = []
        for f in tmp.faces:
            n = f.normal
            cle = 'av' if n.y < -0.5 else 'ar' if n.y > 0.5 else 'g' if n.x < -0.5 else 'd' if n.x > 0.5 else 'h' if n.z > 0.5 else 'b'
            if cle not in faces:
                retirer.append(f)
        if biseau > 0 and not retirer:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=biseau, segments=1, affect='EDGES', profile=0.5)
        bmesh.ops.delete(tmp, geom=retirer, context='FACES_ONLY')
        self._fusionner(tmp, mat)

    def profil_extrude(self, profil, x0, x1, mat):
        """Extrude un profil (liste de (y, z), de bas en haut) le long de X : moulures, corniches."""
        for (y_a, z_a), (y_b, z_b) in zip(profil, profil[1:]):
            # Normale extérieure du segment (tracé de bas en haut, côté rue) : (−dz, dy) dans le plan YZ.
            n = (0, -(z_b - z_a), (y_b - y_a))
            self.quad([(x0, y_a, z_a), (x1, y_a, z_a), (x1, y_b, z_b), (x0, y_b, z_b)], mat, n=n)
        # joues latérales (polygone du profil fermé contre le mur y = 0)
        for x, sens in ((x0, -1), (x1, 1)):
            pts = [(x, y, z) for (y, z) in profil] + [(x, 0.02, profil[-1][1]), (x, 0.02, profil[0][1])]
            a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[2])
            newell = Vector((0, 0, 0))
            for i in range(len(pts)):
                p0, p1 = Vector(pts[i]), Vector(pts[(i + 1) % len(pts)])
                newell.x += (p0.y - p1.y) * (p0.z + p1.z)
            if newell.x * sens < 0:
                pts = list(reversed(pts))
            vs = [self.bm.verts.new(p) for p in pts]
            try:
                f = self.bm.faces.new(vs)
                f.material_index = self.idx_mat(mat)
            except ValueError:
                pass

    def _fusionner(self, tmp, mat):
        idx = self.idx_mat(mat)
        correspondance = {}
        for v in tmp.verts:
            correspondance[v] = self.bm.verts.new(v.co)
        for f in tmp.faces:
            nf = self.bm.faces.new([correspondance[v] for v in f.verts])
            nf.material_index = idx
        tmp.free()

    def objet(self):
        # Pas de recalc_face_normals : sur des pièces ouvertes il retourne des faces au hasard.
        # Chaque face est orientée explicitement à sa création (paramètre n, ou pavés de create_cube).
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        # UV en mètres selon l'orientation de chaque face (sauf faces à UV fournis).
        for f in self.bm.faces:
            if f in self.uv_unitaires:
                continue
            n = f.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop in f.loops:
                c = loop.vert.co
                if ay >= ax and ay >= az:
                    loop[self.uv].uv = (c.x if n.y < 0 else -c.x, c.z)
                elif ax >= az:
                    loop[self.uv].uv = (c.y if n.x > 0 else -c.y, c.z)
                else:
                    loop[self.uv].uv = (c.x, c.y)
        me = bpy.data.meshes.new(self.nom)
        self.bm.to_mesh(me)
        self.bm.free()
        for nom in self.mats:
            me.materials.append(materiau(nom))
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(self.nom, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ——————————————————————————————————————————— Éléments d'architecture
def mur_avec_baie(p, x0, x1, z0, z1, bx0, bx1, bz0, bz1, profondeur, mat='pierre'):
    """Mur plan (y = 0) percé d'une baie rectangulaire, avec ses embrasures."""
    av = (0, -1, 0)
    p.quad([(x0, 0, z0), (bx0, 0, z0), (bx0, 0, z1), (x0, 0, z1)], mat, n=av)
    p.quad([(bx1, 0, z0), (x1, 0, z0), (x1, 0, z1), (bx1, 0, z1)], mat, n=av)
    if bz0 > z0:
        p.quad([(bx0, 0, z0), (bx1, 0, z0), (bx1, 0, bz0), (bx0, 0, bz0)], mat, n=av)
    if bz1 < z1:
        p.quad([(bx0, 0, bz1), (bx1, 0, bz1), (bx1, 0, z1), (bx0, 0, z1)], mat, n=av)
    d = profondeur
    p.quad([(bx0, 0, bz0), (bx0, 0, bz1), (bx0, d, bz1), (bx0, d, bz0)], mat, n=(1, 0, 0))  # embrasure gauche
    p.quad([(bx1, d, bz0), (bx1, d, bz1), (bx1, 0, bz1), (bx1, 0, bz0)], mat, n=(-1, 0, 0))  # droite
    p.quad([(bx0, d, bz1), (bx0, 0, bz1), (bx1, 0, bz1), (bx1, d, bz1)], mat, n=(0, 0, -1))  # tableau haut
    p.quad([(bx0, 0, bz0), (bx0, d, bz0), (bx1, d, bz0), (bx1, 0, bz0)], mat, n=(0, 0, 1))  # appui intérieur


def fenetre(p, bx0, bx1, bz0, bz1, d, detail):
    """Porte-fenêtre à deux vantaux : dormant, montant central, imposte, petits-bois, vitrage."""
    e = 0.06  # section des bois
    y = d - 0.02  # au fond de l'embrasure
    p.quad([(bx0, y + 0.01, bz0), (bx1, y + 0.01, bz0), (bx1, y + 0.01, bz1), (bx0, y + 0.01, bz1)], 'vitre', n=(0, -1, 0))
    b = 0.012 if detail else 0.0
    m = 'menuiserie'
    p.boite(bx0, bx1, y - e, y, bz1 - e, bz1, m, b)  # traverse haute
    p.boite(bx0, bx1, y - e, y, bz0, bz0 + e * 1.4, m, b)  # traverse basse (jet d'eau)
    p.boite(bx0, bx0 + e, y - e, y, bz0, bz1, m, b)
    p.boite(bx1 - e, bx1, y - e, y, bz0, bz1, m, b)
    cx = (bx0 + bx1) / 2
    p.boite(cx - e * 0.6, cx + e * 0.6, y - e * 1.1, y, bz0, bz1 - 0.55, m, b)  # battement central
    p.boite(bx0, bx1, y - e, y, bz1 - 0.55, bz1 - 0.55 + e, m, b)  # imposte
    if detail:
        h = bz1 - 0.55 - bz0
        for k in (1, 2, 3):
            z = bz0 + h * k / 4
            p.boite(bx0, bx1, y - 0.035, y, z - 0.012, z + 0.012, m)
        p.boite(cx - 0.012, cx + 0.012, y - 0.035, y, bz1 - 0.55, bz1, m)


def encadrement(p, bx0, bx1, bz0, bz1, detail):
    """Chambranle mouluré, appui saillant et linteau à corniche (avec clé)."""
    lc = 0.16  # largeur du chambranle
    s = -0.035  # saillie
    b = 0.01 if detail else 0.0
    p.boite(bx0 - lc, bx0, s, 0.0, bz0, bz1 + lc, 'corniche', b, faces=('av', 'g', 'd', 'h', 'b'))
    p.boite(bx1, bx1 + lc, s, 0.0, bz0, bz1 + lc, 'corniche', b, faces=('av', 'g', 'd', 'h', 'b'))
    p.boite(bx0, bx1, s, 0.0, bz1, bz1 + lc, 'corniche', b, faces=('av', 'h', 'b'))
    # Linteau : petite corniche au-dessus du chambranle.
    p.boite(bx0 - lc - 0.08, bx1 + lc + 0.08, -0.11, 0.0, bz1 + lc, bz1 + lc + 0.09, 'corniche', b)
    p.boite(bx0 - lc - 0.04, bx1 + lc + 0.04, -0.07, 0.0, bz1 + lc + 0.09, bz1 + lc + 0.14, 'corniche', b)
    if detail:  # clé de linteau
        cx = (bx0 + bx1) / 2
        p.boite(cx - 0.09, cx + 0.09, -0.06, 0.0, bz1 - 0.02, bz1 + lc + 0.02, 'corniche', 0.008)
    # Appui de fenêtre.
    p.boite(bx0 - lc - 0.05, bx1 + lc + 0.05, -0.13, 0.0, bz0 - 0.09, bz0, 'corniche', b)


def garde_corps(p, x0, x1, y, z0, hauteur):
    """Garde-corps en fer forgé : carte à transparence (UV : 1 motif par 1,5 m) + main courante."""
    u = (x1 - x0) / 1.5
    p.quad([(x0, y, z0), (x1, y, z0), (x1, y, z0 + hauteur), (x0, y, z0 + hauteur)], 'ferronnerie',
           uv=[(0, 0), (u, 0), (u, 1), (0, 1)], n=(0, -1, 0))
    p.boite(x0, x1, y - 0.03, y + 0.03, z0 + hauteur, z0 + hauteur + 0.04, 'fonte')


def bandeau(p, z, hauteur, saillie, detail):
    p.boite(-L / 2, L / 2, -saillie, 0.0, z, z + hauteur, 'corniche', 0.008 if detail else 0.0, faces=('av', 'h', 'b'))


# ——————————————————————————————————————————— Pièces du kit
def travee_etage(nom, balcon, detail):
    p = Piece(nom)
    bx0, bx1 = -0.625, 0.625
    bz0, bz1 = 0.30, 2.65
    d = 0.24
    mur_avec_baie(p, -L / 2, L / 2, 0, H_ETAGE, bx0, bx1, bz0, bz1, d)
    fenetre(p, bx0, bx1, bz0, bz1, d, detail)
    encadrement(p, bx0, bx1, bz0, bz1, detail)
    if balcon == 'filant':
        # Dalle de balcon sur consoles, garde-corps filant.
        p.boite(-L / 2, L / 2, -0.82, 0.0, 0.0, 0.16, 'corniche', 0.015 if detail else 0.0, faces=('av', 'h', 'b'))
        p.boite(-L / 2, L / 2, -0.86, -0.78, 0.0, 0.06, 'corniche', 0.0, faces=('av', 'h', 'b'))
        for cx in (-1.05, 1.05) if detail else ():
            p.boite(cx - 0.11, cx + 0.11, -0.7, 0.0, -0.42, 0.0, 'corniche', 0.012)  # console
        garde_corps(p, -L / 2, L / 2, -0.76, 0.16, 1.0)
    elif balcon == 'balconnet':
        p.boite(bx0 - 0.2, bx1 + 0.2, -0.3, 0.0, 0.18, 0.28, 'corniche', 0.01 if detail else 0.0)
        garde_corps(p, bx0 - 0.15, bx1 + 0.15, -0.26, 0.28, 0.85)
    else:
        bandeau(p, 0.0, 0.22, 0.03, detail)
    return p.objet()


def travee_rdc(nom, porte, detail):
    """Rez-de-chaussée à refends (rainures horizontales), baie de boutique ou porte cochère."""
    p = Piece(nom)
    bx0, bx1 = (-1.15, 1.15) if not porte else (-1.2, 1.2)
    bz1 = 3.55 if not porte else 3.8
    d = 0.38
    # Mur à refends : bandes de 0,45 m en saillie de 2 cm, séparées par des rainures de 2 cm (fermées).
    z = 0.0
    pas = 0.45
    r = 0.02
    while z < 4.2 - 1e-6:
        z1 = min(z + pas - r, 4.2)
        for (a, b) in ((-L / 2, bx0), (bx1, L / 2)):
            p.quad([(a, -r, z), (b, -r, z), (b, -r, z1), (a, -r, z1)], 'pierre', n=(0, -1, 0))
            if detail:
                p.quad([(a, -r, z1), (b, -r, z1), (b, 0, z1), (a, 0, z1)], 'pierre', n=(0, 0, 1))  # dessus de bande
                if z > 0:
                    p.quad([(a, -r, z), (b, -r, z), (b, 0, z), (a, 0, z)], 'pierre', n=(0, 0, -1))  # dessous
                zr = min(z1 + r, 4.2)
                p.quad([(a, 0, z1), (b, 0, z1), (b, 0, zr), (a, 0, zr)], 'pierre', n=(0, -1, 0))  # fond de rainure
                p.quad([(a, -r, z), (a, -r, z1), (a, 0, z1), (a, 0, z)], 'pierre', n=(-1, 0, 0))  # joues
                p.quad([(b, -r, z), (b, -r, z1), (b, 0, z1), (b, 0, z)], 'pierre', n=(1, 0, 0))
        z += pas
    # Au-dessus de la baie (linteau appareillé).
    p.quad([(bx0, -0.02, bz1), (bx1, -0.02, bz1), (bx1, -0.02, 4.2), (bx0, -0.02, 4.2)], 'pierre', n=(0, -1, 0))
    # Embrasures de la baie.
    p.quad([(bx0, -0.02, 0), (bx0, -0.02, bz1), (bx0, d, bz1), (bx0, d, 0)], 'pierre', n=(1, 0, 0))
    p.quad([(bx1, d, 0), (bx1, d, bz1), (bx1, -0.02, bz1), (bx1, -0.02, 0)], 'pierre', n=(-1, 0, 0))
    p.quad([(bx0, d, bz1), (bx0, -0.02, bz1), (bx1, -0.02, bz1), (bx1, d, bz1)], 'pierre', n=(0, 0, -1))
    # Fond de baie : devanture (texture 0–1 choisie par bâtiment) ou porte cochère.
    if porte:
        p.quad([(bx0, d, 0), (bx1, d, 0), (bx1, d, bz1), (bx0, d, bz1)], 'porte', uv=[(0, 0), (1, 0), (1, 1), (0, 1)], n=(0, -1, 0))
        if detail:  # panneaux moulurés de la porte
            for (a, b) in ((bx0 + 0.15, -0.05), (0.05, bx1 - 0.15)):
                p.boite(a, b, d - 0.04, d, 0.25, 1.6, 'porte', 0.01)
                p.boite(a, b, d - 0.04, d, 1.8, bz1 - 0.25, 'porte', 0.01)
    else:
        p.quad([(bx0, d, 0), (bx1, d, 0), (bx1, d, bz1), (bx0, d, bz1)], 'devanture', uv=[(0, 0), (1, 0), (1, 1), (0, 1)], n=(0, -1, 0))
        # Seuil en pierre.
        p.boite(bx0, bx1, -0.02, d, 0.0, 0.06, 'pierre', 0.0, faces=('av', 'h'))
    # Entablement du rez-de-chaussée (corniche intermédiaire).
    p.profil_extrude([(-0.02, 4.2), (-0.06, 4.24), (-0.06, 4.36), (-0.14, 4.44), (-0.18, 4.52), (-0.18, 4.6)], -L / 2, L / 2, 'corniche')
    return p.objet()


def corniche(nom, detail):
    """Corniche principale moulurée (saillie 0,6 m) avec modillons et chéneau."""
    p = Piece(nom)
    prof = [(0.0, -0.5), (-0.05, -0.45), (-0.05, -0.3), (-0.12, -0.25), (-0.18, -0.15), (-0.45, -0.1),
            (-0.52, -0.02), (-0.58, 0.05), (-0.62, 0.15), (-0.62, 0.3)]
    if not detail:
        prof = [(0.0, -0.5), (-0.05, -0.3), (-0.45, -0.1), (-0.62, 0.15), (-0.62, 0.3)]
    p.profil_extrude(prof, -L / 2, L / 2, 'corniche')
    p.quad([(-L / 2, -0.62, 0.3), (L / 2, -0.62, 0.3), (L / 2, 0.0, 0.3), (-L / 2, 0.0, 0.3)], 'zinc', n=(0, 0, 1))  # chéneau
    if detail:
        for k in range(5):
            cx = -L / 2 + 0.3 + k * 0.6
            p.boite(cx - 0.06, cx + 0.06, -0.42, -0.04, -0.16, -0.1, 'corniche', 0.01)  # modillons
    return p.objet()


def lucarne(nom, detail):
    """Lucarne en pierre dans le brisis du toit : fenêtre, fronton cintré simplifié, toiture zinc."""
    p = Piece(nom)
    w, h = 1.3, 1.75
    p.boite(-w / 2, w / 2, -0.1, 0.9, 0.0, h, 'pierre', 0.01 if detail else 0.0, faces=('av', 'g', 'd', 'h'))
    bx0, bx1, bz0, bz1 = -0.4, 0.4, 0.15, 1.35
    # Fenêtre (remplace la face avant pleine : quad vitré légèrement en retrait).
    p.quad([(bx0, -0.11, bz0), (bx1, -0.11, bz0), (bx1, -0.11, bz1), (bx0, -0.11, bz1)], 'vitre', n=(0, -1, 0))
    p.boite(bx0 - 0.06, bx1 + 0.06, -0.14, -0.1, bz0 - 0.06, bz0, 'menuiserie')
    p.boite(bx0 - 0.06, bx0, -0.14, -0.1, bz0, bz1, 'menuiserie')
    p.boite(bx1, bx1 + 0.06, -0.14, -0.1, bz0, bz1, 'menuiserie')
    p.boite(bx0 - 0.06, bx1 + 0.06, -0.14, -0.1, bz1, bz1 + 0.06, 'menuiserie')
    p.boite(-0.02, 0.02, -0.13, -0.1, bz0, bz1, 'menuiserie')
    # Fronton et toit de la lucarne.
    p.boite(-w / 2 - 0.08, w / 2 + 0.08, -0.18, 0.95, h, h + 0.12, 'corniche', 0.01 if detail else 0.0)
    pente = 0.45
    p.quad([(-w / 2 - 0.1, -0.2, h + 0.12), (w / 2 + 0.1, -0.2, h + 0.12), (w / 2 + 0.1, 0.95, h + 0.12 + pente), (-w / 2 - 0.1, 0.95, h + 0.12 + pente)], 'zinc', n=(0, -0.36, 0.93))
    return p.objet()


def store(nom, detail):
    """Store banne de boutique : toile inclinée (2,5 m × 1,3 m), lambrequin, bras métalliques.
    UV 0–1 : u le long de la largeur, v de la façade (0) au bord du lambrequin (1)."""
    p = Piece(nom)
    w = 1.25
    zh, zb, sortie = 3.75, 3.15, -1.3  # haut contre la façade, bas au bord avant
    lam = 0.28  # hauteur du lambrequin
    pente = math.hypot(sortie, zh - zb)
    v1 = pente / (pente + lam)
    n = Vector((0, -(zh - zb), -sortie)).normalized()  # dessus de la toile : vers le haut et l'avant
    p.quad([(-w, 0, zh), (w, 0, zh), (w, sortie, zb), (-w, sortie, zb)], 'toile', uv=[(0, 0), (1, 0), (1, v1), (0, v1)], n=tuple(n))
    p.quad([(-w, 0, zh), (w, 0, zh), (w, sortie, zb), (-w, sortie, zb)], 'toile', uv=[(0, 0), (1, 0), (1, v1), (0, v1)], n=tuple(-n))  # dessous
    p.quad([(-w, sortie, zb), (w, sortie, zb), (w, sortie, zb - lam), (-w, sortie, zb - lam)], 'toile', uv=[(0, v1), (1, v1), (1, 1), (0, 1)], n=(0, -1, 0))
    p.quad([(-w, sortie, zb), (w, sortie, zb), (w, sortie, zb - lam), (-w, sortie, zb - lam)], 'toile', uv=[(0, v1), (1, v1), (1, 1), (0, 1)], n=(0, 1, 0))
    # Barre de charge et bras articulés (fonte).
    p.boite(-w, w, sortie - 0.03, sortie + 0.03, zb - 0.04, zb + 0.02, 'fonte')
    if detail:
        for x in (-w + 0.1, w - 0.1):
            for k in range(6):
                t0, t1 = k / 6, (k + 1) / 6
                y0, y1 = sortie * t0, sortie * t1
                z0, z1 = zh - 0.55 - (zb - 0.02 - (zh - 0.55)) * -t0, zh - 0.55 - (zb - 0.02 - (zh - 0.55)) * -t1
                p.boite(x - 0.015, x + 0.015, min(y0, y1), max(y0, y1) + 0.03, min(z0, z1) - 0.015, max(z0, z1) + 0.015, 'fonte')
    p.boite(-w - 0.05, w + 0.05, -0.12, 0.0, zh - 0.02, zh + 0.12, 'fonte')  # coffre contre la façade
    return p.objet()


# ——————————————————————————————————————————— Construction et export
def vider():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def construire(detail):
    objets = [
        travee_rdc('rdc_boutique', False, detail),
        travee_rdc('rdc_porte', True, detail),
        travee_etage('etage_simple', None, detail),
        travee_etage('etage_balcon', 'filant', detail),
        travee_etage('etage_balconnet', 'balconnet', detail),
        corniche('corniche', detail),
        lucarne('lucarne', detail),
        store('store', detail),
    ]
    # Rangement visuel dans le .blend (sans effet sur l'export : chaque pièce garde son origine).
    for i, ob in enumerate(objets):
        ob.location.x = i * 3.6
    return objets


def exporter(objets, chemin):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    positions = {}
    for ob in objets:
        positions[ob.name] = ob.location.copy()
        ob.location = (0, 0, 0)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=chemin, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='NONE', export_cameras=False, export_lights=False,
        export_animations=False, export_extras=False)
    for ob in objets:
        ob.location = positions[ob.name]
    tris = sum(sum(len(pl.vertices) - 2 for pl in ob.data.polygons) for ob in objets)
    print(f'EXPORT {os.path.basename(chemin)} : {tris} triangles, {os.path.getsize(chemin) // 1024} ko')
    for ob in objets:
        t = sum(len(pl.vertices) - 2 for pl in ob.data.polygons)
        print(f'   {ob.name:18s} {t:6d} triangles  matériaux {[m.name for m in ob.data.materials]}')


def apercu(objets, chemin):
    """Assemble 3 travées × (RDC + 5 étages + corniche + lucarnes) et rend une image Cycles (CPU)."""
    par_nom = {ob.name: ob for ob in objets}
    plan = ['rdc_boutique', 'etage_simple', 'etage_balcon', 'etage_balconnet', 'etage_balconnet', 'etage_balcon']
    copies = []
    for k in range(3):
        x = (k - 1) * L
        z = 0.0
        for i, nom in enumerate(plan):
            c = par_nom[nom if not (k == 1 and i == 0) else 'rdc_porte'].copy()
            c.location = (x, 0, z)
            bpy.context.scene.collection.objects.link(c)
            copies.append(c)
            z += H_RDC if i == 0 else H_ETAGE
        c = par_nom['corniche'].copy(); c.location = (x, 0, z + 0.5); bpy.context.scene.collection.objects.link(c); copies.append(c)
        if k != 1:
            c = par_nom['lucarne'].copy(); c.location = (x, 0.3, z + 1.0); bpy.context.scene.collection.objects.link(c); copies.append(c)
    for ob in objets:
        ob.hide_render = True
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 960, 960
    sc.view_settings.view_transform = 'AgX'
    monde = bpy.data.worlds.new('ciel'); sc.world = monde; monde.use_nodes = True
    fond = monde.node_tree.nodes['Background']
    ciel = monde.node_tree.nodes.new('ShaderNodeTexSky'); ciel.sun_elevation = math.radians(38); ciel.sun_rotation = math.radians(200)
    monde.node_tree.links.new(ciel.outputs['Color'], fond.inputs['Color']); fond.inputs['Strength'].default_value = 0.35
    sol = bpy.data.lights.new('soleil', 'SUN'); sol.energy = 4.0; sol.angle = math.radians(1.5)
    so = bpy.data.objects.new('soleil', sol); so.rotation_euler = (math.radians(52), 0, math.radians(-35)); sc.collection.objects.link(so)
    cam = bpy.data.cameras.new('cam'); cam.lens = 30
    co = bpy.data.objects.new('cam', cam); co.location = (-6.5, -14, 3.0); sc.collection.objects.link(co)
    direction = Vector((0.5, 0, 11.5)) - co.location
    co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler(); sc.camera = co
    sc.render.filepath = chemin
    bpy.ops.render.render(write_still=True)
    for c in copies:
        bpy.data.objects.remove(c)
    for ob in objets:
        ob.hide_render = False
    print('APERCU', chemin)


os.makedirs(SORTIE, exist_ok=True)
APERCU = os.environ.get('APERCU_FACADE')
# Niveau haut : exporté puis conservé dans le .blend source.
vider()
haute = construire(True)
exporter(haute, os.path.join(SORTIE, 'facade-haute.glb'))
if APERCU:
    apercu(haute, APERCU)
os.makedirs(os.path.dirname(SOURCE), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=SOURCE)
print('ENREGISTRE', SOURCE)
# Niveau bas : reconstruit à part pour garder les mêmes noms de nœuds (le script fait foi).
vider()
basse = construire(False)
exporter(basse, os.path.join(SORTIE, 'facade-basse.glb'))
