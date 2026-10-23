#!/usr/bin/env python3
"""City bake: footprints + DEM -> compact binary tiles for the phone.

City-agnostic: everything city-specific lives in tools/bake/cities/<slug>.json.

Inputs (per city config):
  overture    {"release": ...}: OpenStreetMap via Overture Maps (tools/bake/overture.py extracts,
              read by tools/bake/osm.py). Then the footprints are OSM's (real lot lines, courtyards
              cut into pieces), with OSM heights / floors, building parts (tower massing, domes),
              roof shapes / heights / directions, facade + roof colours and materials, names and
              OSM ids (the stable-id key); the ground is OSM's streets by class and width,
              sidewalks, plazas, paths, rail, parks, forest, sand, rock, water and the coastline;
              trees are OSM's mapped trees (+ procedural ones inside real parks); street and
              neighbourhood names go into the terrain tiles for the street sign. ODbL 1.0.
  structures  GeoParquet of building footprints (EPSG:4326) with HEIGHT,
              OCC_CLS, PRIM_OCC, BUILD_ID (FEMA/ORNL USA Structures schema). With "overture":
              only where OSM has nothing (the fallback footprints), and for occupancy + a
              height fallback under OSM footprints. Without: the footprints (rows split into lots).
  dem         USGS 3DEP 1 m DEM GeoTIFFs (any CRS); [] + "groundLevel": a flat city (no DEM).
  lidar       optional {"ept": url, ...}: a USGS 3DEP point cloud (Entwine
              Point Tile), fetched + rasterized by tools/bake/lidar.py. Then
              every building's height comes from its rooftops (tree crowns
              kept off small houses), row lots under one tall roof merge back
              into one building, tall ones get their real outline and stacked
              tiers (setbacks, podiums, tapers, crowns, rooftop boxes), merged
              commercial blocks split along party walls, and towers missing from
              the footprints are added (see lidar_pass). Stable ids of existing
              buildings never move to another building.

Outputs (public/city/<slug>/):
  city.json        manifest (tiles, neighborhoods, landmarks, start pose, attribution)
  b_<tx>_<tz>.bin  buildings in a 256 m tile: one record per building part
                   (tier), footprint rings, heights, style, roof shape, colours,
                   materials, data source ('SBB3'; 'SBB2' without "overture")
  t_<tx>_<tz>.bin  terrain heights (4 m), ground class, obstacle tops (8 m), trees
                   (+ street names and the neighbourhood grid: 'SBT2' with "overture")
  far.bin          skyline LOD (tall buildings as boxes) + 32 m terrain for the
                   whole city, so distant hills and towers loom through the fog

Binary layouts are documented in src/world/tiles.ts (the reader). Keep in sync.

usage: python3 -I tools/bake/bake.py sf [--bbox=lon0,lat0,lon1,lat1] [--out=dirname] [--lidar=0]
       (SB_LIDAR_CACHE=<dir> picks the LiDAR download cache; see lidar.py)
"""
import json
import math
import os
import struct
import sys
import time
from collections import defaultdict

import numpy as np
import geopandas as gpd
import shapely
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.strtree import STRtree
from shapely import affinity
from pyproj import Transformer
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TILE = 256.0
TERRAIN_N = 65           # samples per terrain tile edge (4 m)
TERRAIN_CELL = TILE / (TERRAIN_N - 1)
OBST_N = 32              # obstacle cells per tile edge (8 m)
DEM_RES = 2.0            # resampled DEM resolution in the local frame (m)
FAR_CELL = 32.0
FAR_MIN_HEIGHT = 20.0    # m: buildings in the far skyline (boxes)...
FAR_TIER_HEIGHT = 60.0   # ...towers this tall get a box per big setback...
FAR_MAX_BOXES = 4        # ...at most this many

ARCH = {'generic': 0, 'victorian': 1, 'flats': 2, 'commercial': 3, 'tower': 4, 'stucco': 5, 'marina': 6, 'shed': 7, 'civic': 8}

GROUND_PAVED, GROUND_GRASS, GROUND_WATER, GROUND_SIDEWALK = 0, 1, 2, 3
CLASS_N = 128            # ground-class texels per tile edge (2 m)


def log(*a):
    print(f'[{time.strftime("%H:%M:%S")}]', *a, flush=True)


def hash32(*vals):
    h = 2166136261
    for v in vals:
        for b in struct.pack('<q', int(v)):
            h ^= b
            h = (h * 16777619) & 0xFFFFFFFF
    return h


class Rand:
    """Deterministic per-building RNG (stable across bakes)."""

    def __init__(self, seed):
        self.s = (seed & 0xFFFFFFFF) or 1

    def next(self):
        self.s ^= (self.s << 13) & 0xFFFFFFFF
        self.s ^= self.s >> 17
        self.s ^= (self.s << 5) & 0xFFFFFFFF
        return self.s / 4294967296.0


# ------------------------------------------------------------------ LiDAR massing
# tools/bake/lidar.py fetches the point cloud and rasterizes rooftop elevations;
# this turns one footprint's rooftops into a height, stacked tiers (setbacks,
# podiums, tapers, crowns, rooftop boxes), or a split of a merged block.

MASSING = {
    'tierMinHeight': 25.0,      # m: tiered massing for anything this tall with 1 m LiDAR...
    'tierMinHeightFine': 18.0,  # ...and anything this tall inside the "fine" boxes (downtown)
    'tierMinArea': 120.0,       # m^2: footprint area below which a building stays one prism
    'maxTiers': 6,
    'maxParts': 12,
    'tierTolerance': 0.035,     # stop adding tiers once the stepped massing is within this fraction of the LiDAR volume
    'tierToleranceLow': 0.07,   # ...looser for mid-rises (below 'outlineMinHeight'): roof gardens and HVAC aren't tiers
    'maxTiersLow': 3,
    'maxPartsLow': 5,
    'partMinAreaLow': 80.0,     # m^2 / m: mid-rise tier pieces (smaller rooftop stuff is the mesher's clutter)
    'partMinWidthLow': 5.0,
    'maxVerts': 32,             # outline vertices per part (simplified harder until it fits)
    'tierMinStep': 3.0,         # m: thinnest tier
    'taperMinHeight': 40.0,     # m: shortest run that may taper instead of stepping
    'taperMinDrop': 0.2,        # a run tapers when its area shrinks at least this much bottom to top...
    'taperMinBuilding': 60.0,   # m: only towers this tall taper
    'taperFit': 0.5,            # ...and a ramp fits the run at least this much better (SSE ratio) than a flat step
    'partMinArea': 40.0,        # m^2: smaller tier pieces are dropped (antennas, vents, slivers)
    'partMinWidth': 3.0,        # m: narrower pieces are dropped
    'outlineMinHeight': 40.0,   # m: towers this tall take their outline from the LiDAR (lower ones keep the clean footprint)
    'simplify': 1.2,            # m: outline simplification
    'squareDeg': 14.0,          # edges within this of the building's grid snap square
    'roofPercentile': 50.0,     # robust roof elevation for single prisms (mid-pitch on gables; trees + antennas don't move it)
    'groundAbove': 2.0,         # m: LiDAR cells less than this above the DEM are ground
    'minCoverage': 0.6,         # fraction of a footprint's cells that must hold LiDAR roof returns
    'splitMinArea': 1800.0,     # m^2: merged commercial footprints bigger than this may split
    'splitMinPiece': 220.0,     # m^2
    'splitMinStep': 4.0,        # m: height jump between pieces that counts as a party wall
    'newMinHeight': 20.0,       # m: LiDAR-only buildings (missing from the footprints) at least this tall...
    'newMinArea': 300.0,        # m^2: ...and this big
    'newThresholds': [20.0, 30.0, 45.0, 70.0, 110.0],  # m: outline levels tried in turn
    'towerMinArea': 120.0,      # m^2: a tower's floor plate is at least this big...
    'towerMinFrac': 0.05,       # ...and this fraction of its footprint (its top, not its median, makes it a tower)
    'canopyGap': 4.0,           # m: top (first returns) and low (last returns) roofs this far apart: a tree crown is in the way...
    'canopyMaxHeight': 40.0,    # ...below this (no tree is taller; higher up, glass towers' ghost points fill the low raster)
    'houseMaxArea': 400.0,      # m^2: small residential footprints...
    'houseMaxRise': 6.0,        # m: ...grow at most this much over the footprint height unless the LiDAR roof is one plane:
    'houseAgree': 0.6,          # ...this fraction of its cells within 2.5 m of the roof height
    'needleRatio': 4.0,         # a footprint never grows taller than this x its width when the tall LiDAR blob is mostly outside it
    'mergeMinHeight': 20.0,     # m: row lots of one source footprint under one roof this tall merge back into one building...
    'mergeTol': 0.15,           # ...when their heights agree within this fraction (or 3 m)
    'taperMaxDrop': 0.3,        # a taper narrows at most this much (top scale >= 0.7)...
    'taperConvex': 0.9,         # ...and only on compact outlines: area / convex hull at least this...
    'taperAspect': 1.6,         # ...and no longer than this x their width (slabs step, they don't taper)
    'taperSteps': 0.6,          # ...and the ramp must beat the best 2-3 flat steps of the same run by this (SSE ratio)
    'notchMinHeight': 120.0,    # m: towers this tall keep notched and chamfered corners (Embarcadero Center's sawtooth)...
    'notchSimplify': 0.6,       # m: ...polygonized this finely
    'notchMaxVerts': 48,
}


def load_module(name):
    import importlib.util
    sys.dont_write_bytecode = True  # (no __pycache__ in tools/bake)
    spec = importlib.util.spec_from_file_location('sb_' + name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_lidar_module():
    return load_module('lidar')


def grid_angle(p):
    """Dominant edge direction of a polygon modulo 90 deg (length-weighted), radians."""
    c = np.asarray(p.exterior.coords)
    d = np.diff(c, axis=0)
    L = np.hypot(d[:, 0], d[:, 1])
    a = np.mod(np.arctan2(d[:, 1], d[:, 0]), math.pi / 2)
    # circular mean on the 90-degree circle
    s = float((L * np.sin(a * 4)).sum())
    k = float((L * np.cos(a * 4)).sum())
    return math.atan2(s, k) / 4


def square_up(p, theta, tol_deg, chamfer=2.8):
    """Snap near-axis edges of p (in the frame rotated by theta) exactly square; keeps true diagonals and curves."""
    q = affinity.rotate(p, -theta, origin=(0, 0), use_radians=True)
    ring = np.asarray(q.exterior.coords)[:-1]
    n = len(ring)
    if n < 4:
        return p
    tol = math.radians(tol_deg)
    lines = []  # ('h', z) | ('v', x) | ('g', a, b)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        d = b - a
        L = float(np.hypot(*d))
        if L < 1e-6:
            continue
        ang = math.atan2(d[1], d[0]) % math.pi
        if min(ang, math.pi - ang) < tol:
            ln = ['h', (a[1] + b[1]) / 2, L]
        elif abs(ang - math.pi / 2) < tol:
            ln = ['v', (a[0] + b[0]) / 2, L]
        else:
            ln = ['g', a.copy(), b.copy(), L]
        if lines and lines[-1][0] == ln[0] and ln[0] != 'g' and abs(lines[-1][1] - ln[1]) < 0.8:
            pl = lines[-1]
            pl[1] = (pl[1] * pl[2] + ln[1] * ln[2]) / (pl[2] + ln[2])
            pl[2] += ln[2]
            continue
        if lines and lines[-1][0] == ln[0] and ln[0] != 'g':
            # a jog with no connecting edge (simplification ate it): put the connector back
            lines.append(['v' if ln[0] == 'h' else 'h', a[0] if ln[0] == 'h' else a[1], 0.0])
        lines.append(ln)
    # raster corners come out chamfered (opening + simplification): a short diagonal between two
    # square edges is a corner, not a facet
    i = 0
    while i < len(lines) and len(lines) > 4:
        ln = lines[i]
        a, b = lines[i - 1], lines[(i + 1) % len(lines)]
        if ln[0] == 'g' and ln[3] < chamfer and {a[0], b[0]} == {'h', 'v'}:
            lines.pop(i)
            continue
        i += 1
    if len(lines) >= 2 and lines[0][0] == lines[-1][0] and lines[0][0] != 'g' and abs(lines[0][1] - lines[-1][1]) < 0.8:
        lines[0][1] = (lines[0][1] * lines[0][2] + lines[-1][1] * lines[-1][2]) / (lines[0][2] + lines[-1][2] + 1e-9)
        lines.pop()
    if len(lines) < 3:
        return p

    def isect(l1, l2):
        def abc(l):
            if l[0] == 'h':
                return 0.0, 1.0, l[1]
            if l[0] == 'v':
                return 1.0, 0.0, l[1]
            a, b = l[1], l[2]
            nx, nz = -(b[1] - a[1]), b[0] - a[0]
            return nx, nz, nx * a[0] + nz * a[1]
        a1, b1, c1 = abc(l1)
        a2, b2, c2 = abc(l2)
        det = a1 * b2 - a2 * b1
        if abs(det) < 1e-6:
            return None
        return ((c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det)

    pts = []
    m = len(lines)
    for i in range(m):
        v = isect(lines[i - 1], lines[i])
        if v is None:
            continue
        pts.append(v)
    if len(pts) < 3:
        return p
    out = Polygon(pts)
    if not out.is_valid or out.is_empty:
        return p
    if abs(out.area - q.area) > 0.12 * q.area or out.hausdorff_distance(q) > 2.5:
        return p
    return affinity.rotate(out, theta, origin=(0, 0), use_radians=True)


class Massing:
    """Rooftop heights -> one height, tiers, or a split, for one footprint at a time."""

    def __init__(self, params, heights, dem_at, nodata):
        self.P = dict(MASSING)
        self.P.update(params or {})
        self.heights = heights
        self.dem_at = dem_at
        self.nodata = nodata

    def window(self, poly, fine, pad=3.0):
        from rasterio.features import rasterize
        x0, z0, x1, z1 = poly.bounds
        w = self.heights.window((x0 - pad, z0 - pad, x1 + pad, z1 + pad), fine)
        if w is None:
            return None
        Zq, ox, oz, res = w
        Z = Zq.astype(np.float32) / 10.0
        Z[Zq == self.nodata] = np.nan
        # fill the odd empty cell from its neighbors (max: a rooftop, never a hole)
        for _ in range(2):
            holes = np.isnan(Z)
            if not holes.any():
                break
            Zm = ndimage.maximum_filter(np.where(holes, -1e9, Z), size=3)
            Z[holes] = np.where(Zm[holes] > -1e8, Zm[holes], np.nan)
        tr = rasterio.Affine(res, 0, ox, 0, res, oz)
        mask = rasterize([(poly, 1)], out_shape=Z.shape, transform=tr, fill=0, dtype=np.uint8).astype(bool)
        if mask.sum() < 3:
            return None
        xc = ox + (np.arange(Z.shape[1]) + 0.5) * res
        zc = oz + (np.arange(Z.shape[0]) + 0.5) * res
        XC, ZC = np.meshgrid(xc, zc)
        G = self.dem_at(XC.ravel(), ZC.ravel()).reshape(Z.shape).astype(np.float32)
        # the lowest last returns, same cells (None for rasters cached before there was one)
        Lw = self.heights.window((x0 - pad, z0 - pad, x1 + pad, z1 + pad), res <= 1.0, low=True)
        L = None
        if Lw is not None and Lw[3] == res and Lw[0].shape == Zq.shape:
            L = Lw[0].astype(np.float32) / 10.0
            L[Lw[0] == self.nodata] = np.nan
        return {'Z': Z, 'L': L, 'G': G, 'mask': mask, 'ox': ox, 'oz': oz, 'res': res, 'tr': tr}

    def roof(self, w):
        """Robust roof elevations over the footprint, or None (no coverage / reads as ground):
        {'top': median of the highest first returns (absolute),
         'low': median of the lowest last returns, or None (no data, or they read as ground),
         'lowGround': the last returns read as ground (a crown over a yard, or over a lot that isn't one),
         'agree': fraction of the roof cells within 2.5 m of top (one roof, not a crown of leaves)}."""
        P = self.P
        mask = w['mask']
        inner = ndimage.binary_erosion(mask)
        if inner.sum() < max(3, 0.25 * mask.sum()):
            inner = mask
        Z, G = w['Z'][inner], w['G'][inner]
        ok = ~np.isnan(Z)
        if ok.mean() < P['minCoverage']:
            return None
        nd = Z[ok] - G[ok]
        roofish = nd > P['groundAbove']
        if roofish.mean() < 0.5:
            return None  # mostly ground: demolished since, or misregistered; keep the footprint height
        zr = Z[ok][roofish]
        top = float(np.percentile(zr, P['roofPercentile']))
        out = {'top': top, 'low': None, 'lowGround': False, 'agree': float((np.abs(zr - top) <= 2.5).mean())}
        if w.get('L') is not None:
            Lz = w['L'][inner]
            okl = ~np.isnan(Lz)
            if okl.mean() >= 0.3:
                rl = Lz[okl] - G[okl] > P['groundAbove']
                if rl.mean() >= 0.5:
                    out['low'] = float(np.percentile(Lz[okl][rl], P['roofPercentile']))
                else:
                    out['lowGround'] = True
        return out

    def bare(self, w):
        """The LiDAR covers the footprint and sees (almost) no roof on it: bare ground (demolished since)."""
        P = self.P
        mask = w['mask']
        inner = ndimage.binary_erosion(mask)
        if inner.sum() < max(3, 0.25 * mask.sum()):
            inner = mask
        Z, G = w['Z'][inner], w['G'][inner]
        ok = ~np.isnan(Z)
        if ok.mean() < P['minCoverage']:
            return False
        return float(((Z[ok] - G[ok]) > P['groundAbove']).mean()) < 0.2

    def top_level(self, w, gref):
        """Height above gref of the highest level that still holds a real tower floor plate
        (towerMinArea m^2 and towerMinFrac of the footprint): what decides tower vs mid-rise,
        so a slim tower on a broad podium is a tower although the median roof is the podium."""
        P = self.P
        R = self.rel_heights(w, gref)
        mask = w['mask']
        cell = w['res'] ** 2
        need = max(P['towerMinArea'], P['towerMinFrac'] * mask.sum() * cell) / cell
        v = np.sort(R[mask])[::-1]
        if len(v) < need:
            return float(v[-1]) if len(v) else 0.0
        return float(v[int(math.ceil(need)) - 1])

    def blob_outside(self, poly, fine, gref, level):
        """Area (m^2) of the LiDAR blob at >= level (above gref) that touches the footprint's own tall
        cells, and how much of it lies outside the footprint: a lot that is a sliver of a bigger tower."""
        w = self.window(poly, fine, pad=60.0)
        if w is None:
            return 0.0, 0.0
        Z, G, mask = w['Z'], w['G'], w['mask']
        tall = ~np.isnan(Z) & (Z - G >= self.P['groundAbove']) & (Z - gref >= level)
        tall = ndimage.binary_opening(tall)
        lab, nl = ndimage.label(tall)
        ids = np.unique(lab[mask & tall])
        ids = ids[ids > 0]
        if not len(ids):
            return 0.0, 0.0
        blob = np.isin(lab, ids)
        cell = w['res'] ** 2
        return float(blob.sum() * cell), float((blob & ~mask).sum() * cell)

    def rel_heights(self, w, gref):
        """Height above gref per cell (0 = ground / outside), with the footprint's registration ring repaired."""
        P = self.P
        Z, G, mask = w['Z'], w['G'], w['mask']
        R = np.where(np.isnan(Z), 0.0, Z - gref).astype(np.float32)
        R[(Z - G < P['groundAbove']) | np.isnan(Z)] = 0.0
        R[~mask] = 0.0
        R = np.maximum(R, 0.0)
        # footprints and LiDAR disagree by a meter or so: edge cells that read as ground take the nearest roof
        ring = mask & ~ndimage.binary_erosion(mask, iterations=max(1, int(round(2.0 / w['res']))))
        valid = mask & (R > 0)
        if valid.any():
            bad = ring & ~valid
            if bad.any():
                _, (ii, jj) = ndimage.distance_transform_edt(~valid, return_indices=True)
                R[bad] = R[ii[bad], jj[bad]]
        # speckle (birds, vents, missing returns): median inside the footprint
        Rm = ndimage.median_filter(R, size=3)
        R = np.where(mask, Rm, 0.0)
        return R

    def clean(self, q, theta, tol, notch=False):
        """Simplify + square up one outline, keeping it under maxVerts (coarser until it is), or None.
        notch: a tall tower's outline: finer, short corner diagonals kept (sawtooth corners, chamfers)."""
        P = self.P
        if notch:
            tol = min(tol, P['notchSimplify'])
        q = shapely.make_valid(q)
        if q.geom_type in ('MultiPolygon', 'GeometryCollection'):
            polys = [g for g in getattr(q, 'geoms', []) if g.geom_type == 'Polygon']
            if not polys:
                return None
            q = max(polys, key=lambda g: g.area)
        if q.geom_type != 'Polygon' or q.is_empty:
            return None
        q = Polygon(q.exterior.coords)
        max_verts = P['notchMaxVerts'] if notch else P['maxVerts']
        for t in (tol, tol * 1.6, tol * 2.5, tol * 4.0):
            r = square_up(shapely.simplify(q, t, preserve_topology=True), theta, P['squareDeg'], chamfer=0.0 if notch else 2.8)
            r = shapely.make_valid(r)
            if r.geom_type == 'MultiPolygon':
                r = max(r.geoms, key=lambda g: g.area)
            if r.geom_type != 'Polygon' or r.is_empty:
                return None
            r = Polygon(r.exterior.coords)
            if len(r.exterior.coords) - 1 <= max_verts:
                break
        return r

    def outline(self, w, poly, gref, neighbors, notch=False):
        """The building's real outline from LiDAR, within 2.5 m of its footprint and off its neighbors'
        (footprints are often a rough envelope, a little offset), or None if they disagree too much."""
        from rasterio.features import rasterize
        P = self.P
        Z, G = w['Z'], w['G']
        R = np.where(np.isnan(Z) | (Z - G < P['groundAbove']), 0.0, Z - gref).astype(np.float32)
        R = ndimage.median_filter(R, size=3)
        inner = R[w['mask']]
        if not inner.size:
            return None
        lev = max(4.0, min(10.0, 0.3 * float(np.median(inner))))
        grow = poly.buffer(2.5, join_style='mitre', mitre_limit=2.0)
        gm = rasterize([(grow, 1)], out_shape=R.shape, transform=w['tr'], fill=0, dtype=np.uint8).astype(bool)
        pieces = self.polygons((R >= lev) & gm, w, grid_angle(poly), simplify=self.P['simplify'] * 0.8, notch=notch)
        if not pieces:
            return None
        theta = grid_angle(poly)
        q = max(pieces, key=lambda g: g.area)
        # trim to the grown footprint and off the neighbors; snap first so nearly-coincident
        # edges merge instead of zigzagging, then clean the result again
        q = shapely.make_valid(shapely.snap(q, grow, 1.0).intersection(grow))
        nb = neighbors(poly)
        if nb is not None and not nb.is_empty:
            q = shapely.make_valid(shapely.snap(q, nb, 1.0).difference(nb))
        q = self.clean(q, theta, P['simplify'] * 0.8, notch=notch)
        if q is None:
            return None
        iou = q.intersection(poly).area / max(q.union(poly).area, 1e-6)
        if iou < 0.65 or not (0.75 * poly.area <= q.area <= 1.25 * poly.area):
            return None
        return shapely.geometry.polygon.orient(q, 1.0)

    def polygons(self, m, w, theta, simplify=None, low=False, notch=False):
        """Polygonize a bool mask: opened (drops slivers), holes filled, simplified, squared up.
        notch: a tall tower's tier: opened less (its corner notches are a couple of meters)."""
        from rasterio.features import shapes
        P = self.P
        simplify = P['simplify'] if simplify is None else simplify
        res = w['res']
        min_area = P['partMinAreaLow'] if low else P['partMinArea']
        k = max(1, int(round((P['partMinWidthLow'] if low else P['partMinWidth']) / res)) - (1 if notch else 0))
        m = ndimage.binary_opening(m, structure=np.ones((k, k), bool))
        m = ndimage.binary_fill_holes(m)
        if m.sum() * res * res < min_area:
            return []
        out = []
        for geom, val in shapes(m.astype(np.uint8), mask=m, transform=w['tr']):
            if val != 1:
                continue
            poly = Polygon(geom['coordinates'][0])
            if poly.area < min_area:
                continue
            poly = self.clean(poly, theta, simplify, notch=notch)
            if poly is None or poly.area < min_area:
                continue
            out.append(poly)
        return out

    def tiers(self, w, poly, gref, height):
        """Stacked parts [(poly, topY, tier, parent, topScale)] (part 0 = the footprint), or None for a
        plain prism. topScale < 1: the part tapers (its top outline is its base scaled about the centroid).
        height: the building's top (Massing.top_level, not its median roof), which decides tower vs
        mid-rise, whether it may taper, and whether its corners keep their notches."""
        from rasterio.features import rasterize
        P = self.P
        res = w['res']
        R = self.rel_heights(w, gref)
        mask = w['mask']
        cell = res * res
        top = float(R[mask].max()) if mask.any() else 0.0
        if top < 4.0:
            return None
        levels = np.arange(0.0, math.floor(top) + 1.0, 1.0)
        A = np.array([(R >= t).sum() * cell if t > 0 else mask.sum() * cell for t in levels], dtype=np.float64)
        keep = A >= P['partMinArea']
        if not keep.any():
            return None
        T = int(np.nonzero(keep)[0][-1])  # highest level that still has a real roof
        A = A[:T + 1]
        n = len(A)
        Lmin = int(max(1, round(P['tierMinStep'])))
        Ltap = int(round(P['taperMinHeight']))
        vol = float(A.sum())
        if n < Lmin * 2 or vol <= 0:
            return None
        tower = height >= P['outlineMinHeight']
        notch = height >= P['notchMinHeight']
        # Area-vs-height curve -> optimal k pieces, each flat (a prism) or a ramp (a taper);
        # the smallest k whose stepped/tapered massing is within tolerance of the LiDAR volume.
        t = np.arange(n, dtype=np.float64)
        c = lambda v: np.r_[0.0, np.cumsum(v)]
        S1, S2, St, Stt, StA = c(A), c(A * A), c(t), c(t * t), c(t * A)
        I, J = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing='ij')
        ln = (J - I).astype(np.float64)
        with np.errstate(divide='ignore', invalid='ignore'):
            sa, saa, st, stt, sta = S1[J] - S1[I], S2[J] - S2[I], St[J] - St[I], Stt[J] - Stt[I], StA[J] - StA[I]
            flat = saa - sa * sa / ln
            beta = (ln * sta - st * sa) / (ln * stt - st * st)
            alpha = (sa - beta * st) / ln
            ramp = saa - alpha * sa - beta * sta
        F = np.where(ln < Lmin, np.inf, flat)  # flat steps at least tierMinStep tall
        # tapers: tall enough, narrowing upward, and a much better fit than a flat step (not facade noise)
        ramp[(ln < Ltap) | ~(beta < 0) | ~(ramp < P['taperFit'] * F)] = np.inf
        # ...on a compact tower only (Salesforce, 181 Fremont): slabs and serrated plans step back instead
        cc = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)
        e0, e1 = np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1]))
        compact = poly.area >= P['taperConvex'] * poly.convex_hull.area and max(e0, e1) <= P['taperAspect'] * max(min(e0, e1), 1e-6)
        if height < P['taperMinBuilding'] or not compact:
            ramp[:] = np.inf  # (low roofs that slope are roofs, not tapers)
        if np.isfinite(ramp).any():
            # ...one shaft narrowing about its own axis: several pieces ending at staggered heights (a
            # block of mid-rises) shrink the area curve just as smoothly, but they are steps
            multi = np.zeros(n, bool)
            cen = np.zeros((n, 2))
            for li in range(n):
                lab, nl = ndimage.label(((R >= max(levels[li], 0.5)) & mask) if li else mask)
                if nl == 0:
                    multi[li] = True
                    continue
                sz = np.bincount(lab.ravel())[1:]
                multi[li] = (sz >= 0.1 * sz.sum()).sum() > 1
                jj, ii = np.nonzero(lab == 1 + int(np.argmax(sz)))
                cen[li] = (ii.mean() * res, jj.mean() * res)
            cm = np.r_[0, np.cumsum(multi)]
            I0, J1 = np.clip(I, 0, n - 1), np.clip(J - 1, 0, n - 1)
            bad = (cm[J] - cm[I]) > 0
            bad |= np.hypot(cen[J1, 0] - cen[I0, 0], cen[J1, 1] - cen[I0, 1]) > 0.15 * np.sqrt(A[I0])
            ramp[bad] = np.inf
        if np.isfinite(ramp).any():
            # ...and never where 2-3 flat steps fit nearly as well: a stepped crown is steps
            two = np.empty_like(F)
            for i in range(n + 1):
                two[i] = (F[i][:, None] + F).min(axis=0)
            three = np.empty_like(F)
            for i in range(n + 1):
                three[i] = (two[i][:, None] + F).min(axis=0)
            ramp[~(ramp < P['taperSteps'] * np.minimum(two, three))] = np.inf
        cost = np.minimum(F, ramp)
        tol = P['tierTolerance'] if tower else P['tierToleranceLow']
        best = None
        D = cost[0].copy()  # D[j]: best cost of covering [0, j) with k pieces
        back = []
        for k in range(1, (P['maxTiers'] if tower else P['maxTiersLow']) + 1):
            if k > 1:
                tot = D[:, None] + cost
                arg = np.argmin(tot, axis=0)
                D = tot[arg, np.arange(n + 1)]
                back.append(arg)
            if not np.isfinite(D[n]):
                continue
            br = [n]
            j = n
            for kk in range(k - 1, 0, -1):
                j = int(back[kk - 1][j])
                br.append(j)
            br.append(0)
            br = br[::-1]
            segs = []
            err = 0.0
            for a, b in zip(br[:-1], br[1:]):
                seg, tt = A[a:b], t[a:b]
                fit = np.full(len(seg), seg.mean())
                sc = 1.0
                if ramp[a, b] < flat[a, b]:
                    lf = alpha[a, b] + beta[a, b] * tt
                    a0, a1 = max(lf[0], 1e-6), max(lf[-1], 1e-6)
                    if a1 / a0 < 1.0 - P['taperMinDrop']:
                        fit = lf
                        sc = float(np.clip(math.sqrt(a1 / a0), 1.0 - P['taperMaxDrop'], 1.0))
                err += float(np.abs(seg - fit).sum())
                segs.append((a, b, sc))
            best = segs
            if err <= tol * vol:
                break
        if best is None:
            return None
        if len(best) == 1 and best[0][2] >= 1.0:
            return None
        theta = grid_angle(poly)
        Zw, Gw = w['Z'], w['G']
        Rout = np.where(np.isnan(Zw) | (Zw - Gw < P['groundAbove']), 0.0, Zw - gref)  # unmasked heights

        def scaled(q, sc):  # a taper's top outline (the mesher scales about the same area centroid)
            return q if sc >= 1.0 else affinity.scale(q, sc, sc, origin=q.centroid)

        # [outline, top above gref (None: tier 0's first break), parent, top scale]
        parts = [[poly, None, -1, best[0][2]]]
        prev = [0]
        first_break = (best[1][0] if len(best) > 1 else T + 1) - 0.5
        for si in range(1, len(best)):
            a, b, sc = best[si]
            seg = A[a:b]
            # a taper's outline is its base; a flat tier's is its most typical level
            lev = min(a + 1, b - 1) if sc < 1.0 else a + int(np.argmin(np.abs(seg - seg.mean())))
            m = (R >= max(levels[lev], 0.5)) & mask
            tier_top = b - 0.5 if b < n else T + 0.5
            cur, cont = [], set()
            for q in self.polygons(m, w, theta, low=not tower, notch=notch):
                # sit on the tier below: the parent piece whose (tapered) top it overlaps most
                ov = sorted(((scaled(parts[pi][0], parts[pi][3]).intersection(q).area, pi) for pi in prev), reverse=True)
                if ov and ov[0][0] < 0.5 * q.area:
                    # a "taper" whose narrowed top doesn't carry the tier above wasn't one (a stepped podium)
                    full = max((parts[pi][0].intersection(q).area, pi) for pi in prev)
                    if full[0] >= 0.5 * q.area and parts[full[1]][3] < 1.0:
                        parts[full[1]][3] = 1.0
                        ov = [full]
                if not ov or ov[0][0] < 0.5 * q.area:
                    continue
                par = ov[0][1]
                ptop = scaled(parts[par][0], parts[par][3])
                # snap onto the parent first: a wall flush with the one below continues it exactly
                qq = self.clean(ptop.intersection(shapely.snap(q, ptop, 1.0)), theta, 0.3, notch=notch)
                if qq is None:
                    continue
                qq = shapely.make_valid(ptop.intersection(qq))
                if qq.geom_type in ('MultiPolygon', 'GeometryCollection'):  # (clipping leaves stray edges and points)
                    qq = max([g for g in qq.geoms if g.geom_type == 'Polygon'] or [qq], key=lambda g: g.area)
                if qq.geom_type != 'Polygon' or qq.area < (P['partMinArea'] if tower else P['partMinAreaLow']) or qq.buffer(-P['partMinWidth'] / 2).is_empty:
                    continue
                qq = shapely.simplify(Polygon(qq.exterior.coords), 0.15, preserve_topology=True)
                # each piece's own roof: robust, so a lower tower in a shared tier isn't stretched up
                # (but never below the level it was cut at)
                pm = rasterize([(qq, 1)], out_shape=R.shape, transform=w['tr'], fill=0, dtype=np.uint8).astype(bool) & mask
                own = max(float(np.percentile(R[pm], 85)) if pm.any() else 0.0, levels[lev]) + 0.5
                if not tower and pm.any():
                    # a neighbor's roof spilling into a misregistered footprint: it runs on, just as tall, outside
                    out_ring = ndimage.binary_dilation(pm, iterations=3) & ~mask
                    if out_ring.sum() >= 4 and np.median(Rout[out_ring]) >= 0.8 * own:
                        continue
                tp = min(tier_top, own)
                cq = np.asarray(qq.minimum_rotated_rectangle.exterior.coords)
                width = min(np.hypot(*(cq[1] - cq[0])), np.hypot(*(cq[2] - cq[1])))
                if width < 8.0 and tp - (parts[par][1] or first_break) > 4.0 * width:
                    continue  # a fin: a sliver of the tower the opening cut loose, a mast, a flue
                if qq.area > 0.93 * ptop.area and sc >= 1.0 and parts[par][3] >= 1.0:
                    # same outline as the piece below: not a setback, that piece just runs on up
                    parts[par][1] = max(parts[par][1] or 0.0, tp)
                    cont.add(par)
                    continue
                cur.append([qq, tp, par, sc])
            cur = [cp for cp in cur if cp[2] not in cont]  # (slivers beside a piece that runs on are part of it)
            if not cur and not cont:
                break
            parts += cur
            prev = sorted(cont) + list(range(len(parts) - len(cur), len(parts)))
            if len(parts) >= 64:
                break
        # tier tops: tier 0 tops out at the first break (or runs on); every piece at least a step above
        # its parent; tier = how many pieces it stands on
        t0 = max(first_break, parts[0][1] or 0.0)
        out = [[parts[0][0], gref + t0, 0, -1, parts[0][3]]]
        for q, tp, par, sc in parts[1:]:
            base = out[par][1]
            if tp - (base - gref) < 2.0:
                tp = (base - gref) + 2.0
            out.append([q, gref + tp, out[par][2] + 1, par, sc])
        # the part budget goes to what reads from the street: drop the smallest rooftop boxes (leaves
        # by volume) first, never a piece something stands on (a broad podium's HVAC can't starve its tower)
        cap = P['maxParts'] if tower else P['maxPartsLow']
        while len(out) > cap:
            kids = {o[3] for o in out}
            vol = lambda k: out[k][0].area * (out[k][1] - (out[out[k][3]][1] if out[k][3] >= 0 else gref))
            k = min((k for k in range(1, len(out)) if k not in kids), key=vol)
            del out[k]
            for o in out:
                if o[3] > k:
                    o[3] -= 1
        # a taper must keep its height: a crown clipped short of its run would lean like a roof
        out = [(q, tp, ti, par, sc if sc >= 1.0 or tp - (out[par][1] if par >= 0 else gref) >= 0.75 * P['taperMinHeight'] else 1.0)
               for q, tp, ti, par, sc in out]
        if len(out) == 1 and out[0][4] >= 1.0:
            return None
        return out

    def new_buildings(self, fine, covered, keep_out, log):
        """Buildings the LiDAR sees but the footprint data lacks (towers built since: Salesforce Tower...).
        fine: {(cx, cz): int16 dm chunk} 1 m rasters; covered: [(footprint, its top above ground)]: a cell
        is taken where a footprint (grown 2.5 m for registration) explains the LiDAR there, i.e. the roof
        is no more than 10 m over that footprint's top (a 126 m tower roof over a lot drawn at 9 m is not
        that lot's). Returns [(poly, roof elevation)]."""
        from rasterio.features import rasterize
        P = self.P
        lid = load_lidar_module()
        n = int(lid.CHUNK)
        cov_polys = [q for q, _ in covered]
        cov_tops = [float(t) for _, t in covered]
        cov_tree = STRtree(cov_polys)
        keys = set(fine)
        found = []
        # clusters of adjacent chunks, one raster each
        seen = set()
        for k0 in sorted(keys):
            if k0 in seen:
                continue
            comp, stack = [], [k0]
            seen.add(k0)
            while stack:
                k = stack.pop()
                comp.append(k)
                for dx in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        kk = (k[0] + dx, k[1] + dz)
                        if kk in keys and kk not in seen:
                            seen.add(kk)
                            stack.append(kk)
            c0x, c1x = min(k[0] for k in comp), max(k[0] for k in comp)
            c0z, c1z = min(k[1] for k in comp), max(k[1] for k in comp)
            Wc, Hc = (c1x - c0x + 1) * n, (c1z - c0z + 1) * n
            Zq = np.full((Hc, Wc), lid.NODATA, np.int16)
            have = np.zeros((Hc, Wc), bool)
            for cx, cz in comp:
                Zq[(cz - c0z) * n:(cz - c0z + 1) * n, (cx - c0x) * n:(cx - c0x + 1) * n] = fine[(cx, cz)]
                have[(cz - c0z) * n:(cz - c0z + 1) * n, (cx - c0x) * n:(cx - c0x + 1) * n] = True
            ox, oz = c0x * lid.CHUNK, c0z * lid.CHUNK
            Z = Zq.astype(np.float32) / np.float32(10.0)
            Z[Zq == lid.NODATA] = np.nan
            Zm = ndimage.maximum_filter(np.where(np.isnan(Z), np.float32(-1e9), Z), size=3)
            Z = np.where(np.isnan(Z) & (Zm > -1e8), Zm, Z)
            del Zq, Zm
            xc = ox + np.arange(Wc) + 0.5
            G = np.empty_like(Z)
            for j in range(Hc):
                G[j] = self.dem_at(xc, np.full(Wc, oz + j + 0.5))
            nd = np.where(np.isnan(Z), np.float32(0.0), Z - G)
            del G
            tr = rasterio.Affine(1.0, 0, ox, 0, 1.0, oz)
            from shapely.geometry import box as sbox
            bb = sbox(ox, oz, ox + Wc, oz + Hc)
            near = sorted(((cov_polys[i].buffer(2.5), cov_tops[i] + 10.0) for i in cov_tree.query(bb)), key=lambda t: t[1])
            near += [(g, 1e6) for g in keep_out if g.intersects(bb)]
            if near:
                ctop = rasterize(near, out_shape=Z.shape, transform=tr, fill=-1e9, dtype=np.float32)
                cov = nd <= ctop
                del ctop
            else:
                cov = np.zeros(Z.shape, bool)
            rough = (ndimage.maximum_filter(nd, size=3) - ndimage.minimum_filter(nd, size=3)) < 2.0
            from rasterio.features import shapes
            claimed = np.zeros(nd.shape, bool)
            # rising thresholds: a tower fused to a lower deck or podium separates from it higher up
            for thr in P['newThresholds']:
                cand = (nd >= thr) & ~cov & have & ~claimed
                cand = ndimage.binary_opening(cand, structure=np.ones((5, 5), bool))
                lab, nl = ndimage.label(cand)
                if nl == 0:
                    continue
                idx = np.arange(1, nl + 1)
                areas = ndimage.sum(np.ones(nd.shape, np.float32), lab, idx)
                smooth = ndimage.mean(rough.astype(np.float32), lab, idx)
                tops = ndimage.maximum(nd, lab, idx)
                sl = ndimage.find_objects(lab)
                for li, a, sm, tp in zip(idx, areas, smooth, tops):
                    # flat roofs, unlike tree crowns (towers taller than any tree may wear a rough crown)
                    if a < P['newMinArea'] or (sm < 0.6 and tp < 50.0) or tp < thr + 6.0:
                        continue
                    ys, xs = sl[li - 1]
                    ys = slice(max(0, ys.start - 4), ys.stop + 4)
                    xs = slice(max(0, xs.start - 4), xs.stop + 4)
                    m = lab[ys, xs] == li
                    # a sliver of a mapped building (its footprint is offset): the roof runs on into the footprint.
                    # (Only a thin blob can be one: registration is off by meters, and a tower standing next to
                    # a mapped one, One Rincon's neighbors, has a roof as tall as its neighbor's too.)
                    rim = ndimage.binary_dilation(m, iterations=3) & ~m & cov[ys, xs]
                    if (ndimage.distance_transform_edt(m).max() < 7.0 and rim.sum() > 0.15 * max(1, (ndimage.binary_dilation(m) & ~m).sum())
                            and np.median(nd[ys, xs][rim]) > 0.6 * np.median(nd[ys, xs][m])):
                        continue
                    trw = rasterio.Affine(1.0, 0, ox + xs.start, 0, 1.0, oz + ys.start)
                    geoms = [Polygon(g['coordinates'][0]) for g, v in shapes(m.astype(np.uint8), mask=m, transform=trw) if v == 1]
                    if not geoms:
                        continue
                    g = max(geoms, key=lambda q: q.area)
                    mrr = g.minimum_rotated_rectangle
                    cc = np.asarray(mrr.exterior.coords)
                    e0, e1 = np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1]))
                    if g.area / max(mrr.area, 1e-6) < 0.6 or max(e0, e1) / max(min(e0, e1), 1e-6) > 3.5 or min(e0, e1) < 10:
                        continue  # decks, ramps, rows of trees: not a building (or not yet: try higher)
                    q = self.clean(g, grid_angle(mrr), P['simplify'] * 0.8)
                    if q is None:
                        continue
                    zz = Z[ys, xs][m]
                    roof = float(np.percentile(zz[~np.isnan(zz)], 50))
                    claimed[ys, xs] |= ndimage.binary_dilation(m, iterations=4)
                    found.append((shapely.geometry.polygon.orient(Polygon(q.exterior.coords), 1.0), roof, float(tp)))
        log(f'lidar: {len(found)} buildings missing from the footprints, tallest {max([f[2] for f in found] or [0]):.0f} m')
        return [(q, r) for q, r, _ in found]

    def split(self, w, poly, gref):
        """Cut a merged block into separate buildings along LiDAR height jumps, or None if not clean.
        Never a block with a tower in it: a tower's setbacks are height jumps too, and cutting along
        them sliced towers into side-by-side stripes (its tiers make it one building instead)."""
        P = self.P
        res = w['res']
        R = self.rel_heights(w, gref)
        mask = w['mask']
        if mask.sum() * res * res < P['splitMinArea'] or self.top_level(w, gref) >= P['outlineMinHeight']:
            return None
        # party walls: big height jumps between neighboring cells
        gx = ndimage.maximum_filter(R, size=3) - ndimage.minimum_filter(R, size=3)
        flat = mask & (gx < P['splitMinStep']) & (R > 0)
        lab, nl = ndimage.label(flat)
        if nl < 2:
            return None
        sizes = ndimage.sum(np.ones_like(R), lab, index=np.arange(1, nl + 1)) * res * res
        big = [i + 1 for i, s in enumerate(sizes) if s >= P['splitMinPiece']]
        if len(big) < 2:
            return None
        # every footprint cell joins the nearest big region
        seed = np.isin(lab, big)
        _, (ii, jj) = ndimage.distance_transform_edt(~seed, return_indices=True)
        full = np.where(mask, lab[ii, jj], 0)
        meds = {r: float(np.median(R[full == r])) for r in big}
        # merge neighbors whose heights match (they are one building with a split roof)
        changed = True
        while changed:
            changed = False
            for a in list(meds):
                for b in list(meds):
                    if a >= b or a not in meds or b not in meds:
                        continue
                    touch = (ndimage.binary_dilation(full == a) & (full == b)).any()
                    if touch and abs(meds[a] - meds[b]) < P['splitMinStep']:
                        full[full == b] = a
                        meds[a] = float(np.median(R[full == a]))
                        del meds[b]
                        changed = True
        if len(meds) < 2:
            return None
        from rasterio.features import shapes
        theta = grid_angle(poly)
        pieces = []
        for r in sorted(meds):
            m = full == r
            geoms = [Polygon(g['coordinates'][0]) for g, v in shapes(m.astype(np.uint8), mask=m, transform=w['tr']) if v == 1]
            if not geoms:
                return None
            g = self.clean(shapely.snap(max(geoms, key=lambda q: q.area), poly, 1.5), theta, P['simplify'])
            if g is None:
                return None
            pieces.append(g)
        # exact outer boundary from the footprint, cut lines from LiDAR; pieces tile the footprint
        out = []
        taken = None
        for g in sorted(pieces, key=lambda q: -q.area)[:-1]:
            q = shapely.make_valid(poly.intersection(g))
            if taken is not None:
                q = shapely.make_valid(q.difference(taken))
            if q.geom_type == 'MultiPolygon':
                q = max(q.geoms, key=lambda a: a.area)
            if q.geom_type != 'Polygon' or q.area < P['splitMinPiece']:
                return None
            out.append(q)
            taken = q if taken is None else shapely.make_valid(taken.union(q))
        rest = shapely.make_valid(poly.difference(taken))
        if rest.geom_type == 'MultiPolygon':
            parts = sorted(rest.geoms, key=lambda a: -a.area)
            rest = parts[0]
            if sum(p.area for p in parts[1:]) > 0.05 * poly.area:
                return None
        if rest.geom_type != 'Polygon' or rest.area < P['splitMinPiece']:
            return None
        out.append(rest)
        clean = []
        for q in out:
            q = shapely.simplify(Polygon(q.exterior.coords), 0.2, preserve_topology=True)
            # "clean": compact pieces only (no long slivers along a party wall)
            if q.area < P['splitMinPiece'] or q.area / max(q.minimum_rotated_rectangle.area, 1e-6) < 0.55 or q.buffer(-2.5).is_empty:
                return None
            clean.append(q)
        return clean


NEW_SPLIT_BASE = 1 << 30   # stableIds of buildings only a LiDAR bake has: pieces split off a block...
SPLIT_SLOTS = 64           # ...(64 ids per parent footprint)...
NEW_LIDAR_BASE = 3 << 30   # ...and towers the footprint data lacks (both far above any footprint rank)

# Stable ids with OpenStreetMap footprints ("overture" configs): derived from what each building is (its
# source record), never from a rank, so a re-bake keeps every id on its building even when buildings
# come and go around it (what a shared paint server will key on):
#   [0, 2^31)                 OSM buildings: FNV-1a of the OSM id ('w123', 'r45', no version)
#   [2^31, 2^31 + 2^29)       Overture footprints from other sources (Microsoft ML, Esri): of the GERS id
#   [2^31 + 2^29, 3 * 2^30)   USA Structures fallback lots ('u<BUILD_ID>:<lot>') and pieces LiDAR splits off them
#   [3 * 2^30, 2^32)          LiDAR-only towers (NEW_LIDAR_BASE + a hash of their 8 m-grid position, as before)
# A collision probes to the next free id in its range, in key order (deterministic for the same data).
ID_RANGES = {'osm': (0, 1 << 31), 'ovt': (1 << 31, 1 << 29), 'usa': ((1 << 31) + (1 << 29), 1 << 29)}


def fnv_str(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


class IdAlloc:
    def __init__(self):
        self.used = set()
        self.collisions = 0

    def take(self, src, key):
        lo, n = ID_RANGES[src]
        h = fnv_str(key) % n
        while lo + h in self.used:
            h = (h + 1) % n
            self.collisions += 1
        self.used.add(lo + h)
        return lo + h


# roof shapes (osm.ROOF_SHAPES codes): default rise as a fraction of the footprint's short side
ROOF_RISE = {2: 0.32, 3: 0.32, 4: 0.42, 5: 0.12, 6: 0.5, 7: 0.9, 8: 0.35, 9: 0.36, 10: 0.24, 11: 0.32, 12: 0.32, 13: 0.8}
ROOF_TOWERISH = (4, 6, 7, 13)  # pyramids, domes, onions and cones may be most of a part's height


def roof_for(poly, roof, top, base, median):
    """(shape, rise m, direction byte, eave Y) for one part. roof: {'shape', 'height', 'direction', 'orientation'};
    top: the part's top (absolute); median: the height is a LiDAR median roof (mid-pitch), not the ridge.
    direction byte: angle (local frame, atan2(dz, dx), 256 = full turn) of the way the main roof face looks
    (downhill); the ridge runs perpendicular to it. Untagged / flat roofs: (shape, 0, 0, top)."""
    shape = roof.get('shape', 0) if roof else 0
    if shape in (0, 1):
        return shape, 0.0, 0, top
    mrr = poly.minimum_rotated_rectangle
    cc = np.asarray(mrr.exterior.coords)
    e0, e1 = cc[1] - cc[0], cc[2] - cc[1]
    l0, l1 = float(np.hypot(*e0)), float(np.hypot(*e1))
    W = min(l0, l1)
    longv = e0 if l0 >= l1 else e1
    R = roof.get('height')
    if not R or R <= 0:
        R = ROOF_RISE.get(shape, 0.3) * W
        if shape in (2, 3, 9, 11, 12):
            R = float(np.clip(R, 1.0, 7.0))
    H = top - base
    R = float(min(R, H * (0.9 if shape in ROOF_TOWERISH else 0.6)))
    if R < 0.4:
        return 1, 0.0, 0, top
    if median:
        top = top + R / 2  # a LiDAR median roof is mid-pitch
    eave = top - R
    d = roof.get('direction')
    if d is not None:
        b = math.radians(d)  # compass bearing the roof face looks toward -> local (+x east, +z south)
        ang = math.atan2(-math.cos(b), math.sin(b))
    else:
        ridge = math.atan2(longv[1], longv[0])
        if roof.get('orientation') == 'across':
            ridge += math.pi / 2
        ang = ridge + math.pi / 2
    return shape, R, int(round(ang / (2 * math.pi) * 256)) % 256, eave


def parts_massing(b, plist, maxparts=24):
    """OSM building parts -> [{poly, base, top (above the ground), tier, par, roof, colours...}] (tier 0 = parts on
    the ground, the biggest first), or None when they don't describe the building (they cover too little of it)."""
    recs = []
    for part in plist:
        base = part['minH'] if part['minH'] is not None else (part['minFloor'] * 3.2 if part['minFloor'] else 0.0)
        top = part['h']
        if top is None and part['floors']:
            top = base + part['floors'] * 3.2 + 0.6
        if top is None:
            top = b['h']
        if top - base < 0.5:
            continue
        for q in part['polys']:
            recs.append(dict(part, poly=shapely.geometry.polygon.orient(q, 1.0), base=float(base), top=float(top)))
    if not recs:
        return None
    try:
        cover = shapely.unary_union([r['poly'] for r in recs]).intersection(b['poly']).area
    except shapely.errors.GEOSException:
        return None
    if cover < 0.75 * b['poly'].area:
        return None
    # a part above the ground stands on another part (its base within 3 m of that part's top, overlapping
    # it by 30 %), else it floats (an overhang, a skybridge: nothing under it) and goes
    recs.sort(key=lambda r: (r['base'], -r['poly'].area))
    kept = []
    for r in recs:
        if r['base'] < 1.0:
            r['tier'], r['par'] = 0, -1
            kept.append(r)
            continue
        try:
            sup = [k for k, o in enumerate(kept) if abs(o['top'] - r['base']) <= 3.0 and o['poly'].intersection(r['poly']).area >= 0.3 * r['poly'].area]
        except shapely.errors.GEOSException:
            sup = []
        if not sup:
            continue
        r['par'] = max(sup, key=lambda k: kept[k]['poly'].intersection(r['poly']).area)
        r['tier'] = min(250, kept[r['par']]['tier'] + 1)
        kept.append(r)
    if not kept or kept[0]['tier'] != 0:
        return None
    # the budget goes by volume: the smallest pieces nothing stands on go first
    while len(kept) > maxparts:
        kids = {r['par'] for r in kept}
        k = min((k for k in range(1, len(kept)) if k not in kids), key=lambda k: kept[k]['poly'].area * (kept[k]['top'] - kept[k]['base']), default=None)
        if k is None:
            break
        del kept[k]
        for r in kept:
            if r['par'] > k:
                r['par'] -= 1
    return sorted([r for r in kept if r['tier'] == 0], key=lambda r: -r['poly'].area) + sorted([r for r in kept if r['tier'] > 0], key=lambda r: (r['tier'], -r['poly'].area))


def model_error(massing, w, shapes, gref):
    """Mean |model - LiDAR| roof height over the footprint, relative to the LiDAR's mean height. shapes: [(poly,
    top above gref)], drawn in order (later ones win)."""
    from rasterio.features import rasterize
    R = massing.rel_heights(w, gref)
    m = w['mask']
    if m.sum() < 3:
        return None
    shapes = [(q, float(t)) for q, t in shapes if q is not None and not q.is_empty]
    M = (rasterize(shapes, out_shape=R.shape, transform=w['tr'], fill=0.0, dtype=np.float32, merge_alg=rasterio.enums.MergeAlg.replace)
         if shapes else np.zeros(R.shape, np.float32))
    return float(np.abs(M[m] - R[m]).mean() / max(float(R[m].mean()), 3.0))


def with_holes(b):
    """A building's footprint with its courtyards (OSM path), else its footprint."""
    if not b.get('holes'):
        return b['poly']
    try:
        q = shapely.make_valid(Polygon(b['poly'].exterior.coords, [h.exterior.coords for h in b['holes']]))
        return q if q.geom_type in ('Polygon', 'MultiPolygon') else b['poly']
    except (shapely.errors.GEOSException, ValueError):
        return b['poly']


def ground_stats_at(dem_at, p):
    """(lowest, mean) ground under a footprint's ring and centroid."""
    c = np.asarray(p.exterior.coords)[:-1]
    gy = dem_at(c[:, 0], c[:, 1])
    cy = float(dem_at([p.centroid.x], [p.centroid.y])[0])
    return float(min(gy.min(), cy)), float((gy.mean() + cy) * 0.5)


SRC_CODE = {'osm': 0, 'ovt': 1, 'usa': 2, 'lidar': 3}
HSRC_CODE = {'default': 0, 'lidar': 1, 'osm': 2, 'floors': 3, 'usa': 4, 'neighbors': 5}


def source_byte(b, q):
    """SBB3 source byte: bits 0-2 the footprint (0 OSM, 1 Overture other, 2 USA Structures, 3 LiDAR only),
    bits 3-5 the height (0 default, 1 LiDAR, 2 OSM height, 3 OSM floors, 4 USA Structures, 5 neighbours),
    bit 6 massing from OSM building parts, bit 7 LiDAR tiers."""
    v = SRC_CODE.get(b.get('src'), 2) | (HSRC_CODE.get(b.get('hsrc') or 'default', 0) << 3)
    if b.get('osmParts'):
        v |= 64
    elif b.get('tiered'):
        v |= 128
    return v


def lidar_pass(buildings, cfg, massing, fine_raster, ll2xz, dem_at, log, ids=None, parts_of=None):
    """LiDAR rooftops for the ranked buildings; returns the new list (it shrinks and grows):
      1. row lots of one source footprint standing under one tall roof merge back into one building
         (an apartment block the lot splitter cut into 8 m stripes, each painting on its own)
      2. merged commercial blocks split along party walls
      3. every height from its rooftops, except where a tree crown is in the way (top and low rasters
         disagree) and where a lot is a sliver of a bigger tower (that tower comes from step 4)
      4. towers the footprint data lacks are added from the 1 m raster
      5. tall ones (by their top, not their median roof) get their real outline and stacked tiers
    Stable ids: existing buildings keep theirs; a merged building keeps its biggest lot's (the other
    lots' ids retire with them). New ids derive from what the building is, never from a counter, so a
    re-bake gives the same building the same id: split pieces NEW_SPLIT_BASE + parent * 64 + a hash of
    their position, LiDAR-only towers NEW_LIDAR_BASE + a hash of their position (8 m grid).
    With OSM footprints (ids: an IdAlloc): only USA Structures fallback rows are merged or split (OSM's
    footprints are real buildings), split pieces take ids from the allocator ('<key>/s<slot>'), a fallback
    footprint the LiDAR sees as bare ground is dropped (demolished since), and buildings with OSM building
    parts (parts_of: {GERS id: parts}) take their massing from the parts where those agree with the LiDAR
    (else the LiDAR tiers below)."""
    from rasterio.features import rasterize
    P = massing.P
    gs = lambda p: ground_stats_at(dem_at, p)
    orient = lambda q: shapely.geometry.polygon.orient(q, 1.0)
    log('lidar massing')
    fine_boxes = []
    for lo0, la0, lo1, la1 in cfg['lidar'].get('fine', []):
        (xa, za), (xb, zb) = ll2xz(lo0, la0), ll2xz(lo1, la1)
        fine_boxes.append((min(xa, xb), min(za, zb), max(xa, xb), max(za, zb)))

    def in_fine(p):
        x, z = p.centroid.x, p.centroid.y
        return any(bx0 <= x <= bx1 and bz0 <= z <= bz1 for bx0, bz0, bx1, bz1 in fine_boxes)

    # 1) row lots back into one building under one tall roof
    rows = defaultdict(list)
    for b in buildings:
        if not b.get('landmark'):
            rows[b['srckey'][0]].append(b)
    gone, nmerge, nlots = set(), 0, 0
    for lots in rows.values():
        if len(lots) < 2:
            continue
        union = MultiPolygon([b['poly'] for b in lots])  # (only its bounds and cells: no topology needed)
        w = massing.window(union, True) or massing.window(union, False)
        if w is None:
            continue
        g_all = float(np.mean([gs(b['poly'])[1] for b in lots]))
        r = massing.roof(w)
        if r is None or r['top'] - g_all < 0.6 * P['mergeMinHeight']:
            continue  # (a row of houses: most sources)
        hs = {}
        for b in lots:
            m = rasterize([(b['poly'], 1)], out_shape=w['Z'].shape, transform=w['tr'], fill=0, dtype=np.uint8).astype(bool)
            r = massing.roof(dict(w, mask=m)) if m.sum() >= 3 else None
            if r is None:
                continue
            h = r['top'] - gs(b['poly'])[1]
            # a tall flat roof; below tower heights not a tree crown (the last returns reach the roof).
            # (Above them the lowest last return means nothing: glass towers scatter ghost points under them.)
            leafy = r['lowGround'] or r['low'] is None or r['top'] - r['low'] > P['canopyGap']
            if h >= P['mergeMinHeight'] and r['agree'] >= 0.5 and (h >= P['canopyMaxHeight'] or not leafy):
                hs[id(b)] = h
        tall = [b for b in lots if id(b) in hs]
        if len(tall) < 2:
            continue
        root = {id(b): id(b) for b in tall}

        def find(k):
            while root[k] != k:
                root[k] = root[root[k]]
                k = root[k]
            return k
        for i, b1 in enumerate(tall):
            for b2 in tall[i + 1:]:
                h1, h2 = hs[id(b1)], hs[id(b2)]
                if abs(h1 - h2) <= max(3.0, P['mergeTol'] * max(h1, h2)) and b1['poly'].distance(b2['poly']) < 0.3:
                    root[find(id(b1))] = find(id(b2))
        groups = defaultdict(list)
        for b in tall:
            groups[find(id(b))].append(b)
        for grp in groups.values():
            if len(grp) < 2:
                continue
            try:
                q = shapely.unary_union([g['poly'].buffer(0.05, join_style='mitre') for g in grp]).buffer(-0.05, join_style='mitre')
            except shapely.errors.GEOSException:
                continue
            if q.geom_type == 'MultiPolygon':
                big = max(q.geoms, key=lambda g: g.area)
                if big.area < 0.95 * q.area:
                    continue
                q = big
            if q.geom_type != 'Polygon' or q.is_empty:
                continue
            # only a roof that stands on these lots: a tower that runs on over other lots and empty ground
            # (one built since, on lots that were houses) is a building the footprints lack (step 4)
            gmin = gs(q)[0]
            blob, outside = massing.blob_outside(q, True, gmin, 0.6 * float(np.median([hs[id(g)] for g in grp])))
            if outside > 0.35 * blob:
                continue
            keep = max(grp, key=lambda g: (g['poly'].area, -g['stable']))
            keep['poly'] = orient(shapely.simplify(Polygon(q.exterior.coords), 0.2, preserve_topology=True))
            keep['front_edge_hint'] = None
            keep['h'] = max(hs[id(g)] for g in grp)
            gone.update(id(g) for g in grp if g is not keep)
            nmerge += 1
            nlots += len(grp)
    buildings = [b for b in buildings if id(b) not in gone]
    log(f'lidar: merged {nlots} row lots back into {nmerge} buildings under one roof')

    # 2) merged commercial blocks: split along party walls (the biggest piece keeps the block's id)
    extra, nsplit = [], 0
    for b in sorted(buildings, key=lambda b: b['stable']):
        if b.get('landmark') or b['poly'].area < P['splitMinArea'] or b['occ'] in ('Residential', ''):
            continue
        if ids is not None and b.get('src') != 'usa':
            continue
        w = massing.window(b['poly'], True) or massing.window(b['poly'], False)
        if w is None:
            continue
        gmin, _ = gs(b['poly'])
        try:
            pieces = massing.split(w, b['poly'], gmin)
        except shapely.errors.GEOSException:
            pieces = None
        if not pieces or len(pieces) > 16:
            continue
        nsplit += 1
        pieces.sort(key=lambda q: -q.area)
        b['poly'] = orient(pieces[0])
        # each piece's slot is a hash of where it is (8 m grid), so a piece keeps its id when another
        # piece of the block comes or goes (a rank would hand it to the next one over)
        slots = set()
        for hk, _, _, q in sorted((hash32(int(round(q.centroid.x / 8.0)), int(round(q.centroid.y / 8.0))) % SPLIT_SLOTS, q.centroid.y, q.centroid.x, q)
                                  for q in pieces[1:]):
            while hk in slots:
                hk = (hk + 1) % SPLIT_SLOTS
            slots.add(hk)
            nb = dict(b)
            nb['poly'] = orient(q)
            nb['stable'] = ids.take('usa', f"{b['key']}/s{hk}") if ids is not None else NEW_SPLIT_BASE + b['stable'] * SPLIT_SLOTS + hk
            nb['srckey'] = (b['srckey'][0], b['srckey'][1], hk + 1)
            extra.append(nb)
    buildings += extra
    log(f'lidar: split {nsplit} merged blocks into {nsplit + len(extra)} buildings')

    # 3) every building's height from its rooftops
    dh, nfix, ncanopy, nhouse, nsliver = [], 0, 0, 0, 0
    demolished = set()
    for b in buildings:
        if b.get('landmark'):
            continue
        p = b['poly']
        gmin, gmean = gs(p)
        tall = b['h'] >= P['tierMinHeight'] or (in_fine(p) and b['h'] >= P['tierMinHeightFine'])
        w = (massing.window(p, True) if tall else None) or massing.window(p, False)
        if w is None:
            continue
        r = massing.roof(w)
        if r is None:
            if ids is not None and b.get('src') == 'usa' and massing.bare(w):
                demolished.add(id(b))  # a fallback footprint OSM doesn't have and the LiDAR sees as bare ground
            continue
        h_top = max(3.0, r['top'] - gmean)
        if h_top > b['h'] + 6.0:
            cc = np.asarray(p.minimum_rotated_rectangle.exterior.coords)
            width = min(np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1])))
            if h_top > P['needleRatio'] * width:
                blob, outside = massing.blob_outside(p, True, gmin, 0.6 * h_top)
                if outside > 0.5 * blob:
                    b['sliver'] = True  # a sliver of a taller blob: keeps its height, the blob is step 4's
                    nsliver += 1
                    continue
        h_new, top_h = h_top, None
        low = None if r['low'] is None else r['low'] - gmean
        house = b['occ'] in ('Residential', 'Unclassified', '') and p.area < P['houseMaxArea']
        if house and h_top < P['canopyMaxHeight'] and (r['lowGround'] or (low is not None and h_top - low > P['canopyGap'])):
            # a small house under a tree crown (the last returns say the roof, or the yard, is meters
            # below the first): the footprint height, within what the returns allow
            h_new = float(np.clip(b['h'], 3.0 if low is None else max(3.0, low), h_top))
            top_h = h_new
            ncanopy += 1
        elif house and h_new > b['h'] + P['houseMaxRise'] and r['agree'] < P['houseAgree']:
            h_new = top_h = b['h'] + P['houseMaxRise']  # (a small house whose "roof" is no plane)
            nhouse += 1
        dh.append(h_new - b['h'])
        b['h'] = h_new
        b['hsrc'] = 'lidar'
        b['topH'] = massing.top_level(w, gmin) if top_h is None else top_h
        nfix += 1
    dh = np.array(dh) if dh else np.zeros(1)
    log(f'lidar: corrected {nfix}/{len(buildings)} heights (median change {np.median(dh):+.1f} m, |change| > 3 m: '
        f'{int((np.abs(dh) > 3).sum())}); {ncanopy} under tree crowns, {nhouse} small houses capped, {nsliver} slivers of a taller blob')
    if demolished:
        buildings = [b for b in buildings if id(b) not in demolished]
        log(f'lidar: {len(demolished)} fallback footprints dropped (bare ground in the LiDAR: demolished since)')

    # 4) towers the footprint data never had (built since), from the 1 m LiDAR alone
    covered = [(b['poly'], max(b['h'], b.get('topH', b['h']))) for b in buildings if not b.get('sliver')]
    keep_out = []
    for lm in cfg.get('landmarks', []):
        if lm.get('clearRadius'):
            keep_out.append(shapely.Point(*ll2xz(lm['lon'], lm['lat'])).buffer(float(lm['clearRadius']) + 15.0))
        if 'points' in lm:  # bridges: their decks and towers are hand-built (the deck's width, no more:
            # the Bay Bridge lands on Rincon Hill, among towers the footprints lack)
            keep_out.append(shapely.LineString([ll2xz(lo, la) for la, lo in lm['points']]).buffer(20.0))
    new = massing.new_buildings(fine_raster, covered, keep_out, log)
    used = {b['stable'] for b in buildings}
    keyed = sorted(((hash32(int(round(q.centroid.x / 8.0)), int(round(q.centroid.y / 8.0))) & 0x0FFFFFFF, q.centroid.y, q.centroid.x, q, roof)
                    for q, roof in new), key=lambda t: t[:3])
    for k, (hk, _, _, q, roof) in enumerate(keyed):
        sid = NEW_LIDAR_BASE + hk
        while sid in used:
            sid += 1
        used.add(sid)
        _, gmean = gs(q)
        buildings.append({'poly': q, 'h': max(3.0, roof - gmean), 'occ': 'Commercial', 'prim': '', 'srckey': (-1, k),
                          'front_edge_hint': None, 'stable': sid, 'parts': None, 'lidarOnly': True, 'topH': roof - gmean,
                          'src': 'lidar', 'hsrc': 'lidar', 'key': f'lidar:{hk}'})

    # 5) tall buildings: real outline + tiers (decided by their top: a slim tower on a broad podium is a tower)
    # (slivers aren't neighbors: a tower's outline must not be trimmed off the lots it stands over)
    polys_n = [b['poly'] for b in buildings if not b.get('sliver')]
    tree_n = STRtree(polys_n)

    def neighbors(p):
        idx = [i for i in tree_n.query(p.buffer(3.0)) if not polys_n[i].equals(p)]
        if not idx:
            return None
        try:
            return shapely.unary_union([shapely.make_valid(polys_n[i]) for i in idx])
        except shapely.errors.GEOSException:
            return shapely.unary_union([shapely.make_valid(polys_n[i]).buffer(0.01) for i in idx])

    ntier, nparts, nout, nbad, nflat = 0, 0, 0, 0, 0
    npused, nprej, npnolidar = 0, 0, 0
    for b in buildings:
        if b.get('landmark') or not (parts_of and b.get('hasParts') and b.get('gers') in parts_of):
            continue
        # OSM building parts: the mapped massing (setbacks, domes, spires), checked against the LiDAR; where
        # they disagree badly with the rooftops the LiDAR tiers below take over
        p = b['poly']
        gmin, gmean = gs(p)
        recs = parts_massing(b, parts_of[b['gers']])
        if not recs:
            continue
        w = massing.window(p, True) or massing.window(p, False)
        if w is None:
            b['osmParts'] = recs
            npnolidar += 1
            continue

        def tops(r):  # (a pitched / domed roof counts at mid-rise)
            sh, R, _, eave = roof_for(r['poly'], r['roof'], gmin + r['top'], gmin + r['base'], False)
            return eave + 0.5 * R - gmin
        e_p = model_error(massing, w, [(r['poly'], tops(r)) for r in sorted(recs, key=tops)], gmin)
        e_t = None
        hi = max(b['h'], b.get('topH', b['h']))
        if (hi >= P['tierMinHeight'] or (in_fine(p) and hi >= P['tierMinHeightFine'])) and p.area >= P['tierMinArea']:
            w1 = massing.window(p, True)
            try:
                tiers = massing.tiers(w1, p, gmin, massing.top_level(w1, gmin)) if w1 is not None else None
            except shapely.errors.GEOSException:
                tiers = None
            if tiers:
                e_t = model_error(massing, w1, [(q, tp - gmin) for q, tp, _, _, _ in sorted(tiers, key=lambda t: t[1])], gmin)
        flat_e = model_error(massing, w, [(p, b['h'])], gmin)
        ref = min([e for e in (e_t, flat_e) if e is not None], default=None)
        b['partsErr'] = (e_p, e_t, flat_e)
        # "agree": the parts explain the rooftops about as well as the best LiDAR model does (within 5 % of the
        # mean height) and never worse than 25 %
        if e_p is not None and e_p <= min(0.25, (ref if ref is not None else 0.2) + 0.05):
            b['osmParts'] = recs
            npused += 1
        else:
            nprej += 1
    log(f'osm parts: {npused} buildings take their massing from OSM building parts (LiDAR agrees), {npnolidar} without LiDAR to check, '
        f'{nprej} rejected (the LiDAR tiers / plain roof fit the rooftops better)')
    fmt = lambda e: '-' if e is None else f'{e:.2f}'
    for b in sorted([b for b in buildings if 'partsErr' in b], key=lambda b: -b['h'])[:16]:
        e_p, e_t, e_f = b['partsErr']
        log(f"  parts {'USED' if b.get('osmParts') else 'rejected'}: {b.get('name') or b['key']} {b['h']:.0f} m: parts err {fmt(e_p)}, LiDAR tiers {fmt(e_t)}, flat {fmt(e_f)}")
    for b in buildings:
        if b.get('landmark') or b.get('sliver') or 'topH' not in b or b.get('osmParts'):
            continue
        p = b['poly']
        hi = max(b['h'], b['topH'])
        if not (hi >= P['tierMinHeight'] or (in_fine(p) and hi >= P['tierMinHeightFine'])) or p.area < P['tierMinArea']:
            continue
        w = massing.window(p, True)  # (the 1 m raster: every tall footprint has it)
        if w is None:
            continue
        gmin, gmean = gs(p)
        top_h = massing.top_level(w, gmin) if b['topH'] > b['h'] else b['topH']
        q = None
        try:
            if top_h >= P['outlineMinHeight']:
                q = massing.outline(w, p, gmin, neighbors, notch=top_h >= P['notchMinHeight'])
        except shapely.errors.GEOSException:
            nbad += 1  # degenerate geometry: keep the footprint
        if q is not None:
            w2 = massing.window(q, True)
            if w2 is not None:
                b['poly'], p, w = q, q, w2
                b['holes'] = None  # (the LiDAR outline: OSM's courtyards may not sit in it)
                gmin, gmean = gs(p)
                nout += 1
        try:
            tiers = massing.tiers(w, p, gmin, top_h)
        except shapely.errors.GEOSException:
            tiers, nbad = None, nbad + 1
        if tiers:
            b['parts'] = tiers
            b['tiered'] = True
            b['h'] = max(t[1] for t in tiers) - gmean
            ntier += 1
            nparts += len(tiers)
        elif top_h > b['h'] + 10.0:
            nflat += 1  # (a tall top the stacking couldn't place: drawn at its median roof)
    if nbad:
        log(f'lidar: {nbad} footprints with degenerate geometry kept as they were')
    log(f'lidar: {nout} outlines from LiDAR, {ntier} tiered buildings, {nparts} parts; {nflat} tall tops left flat')

    # slivers standing mostly (60 %) inside the tower they were a sliver of (its final outline) retire into
    # it, like merged lots: hidden inside, they'd only cost triangles and catch the splat meant for the tower
    towers = [b['poly'] for b in buildings if b.get('lidarOnly')]
    if towers:
        tree_t = STRtree(towers)
        retired = set()
        for b in buildings:
            if b.get('sliver'):
                p = b['poly']
                try:
                    if any(shapely.make_valid(towers[i]).intersection(p).area >= 0.6 * p.area for i in tree_t.query(p)):
                        retired.add(id(b))
                except shapely.errors.GEOSException:
                    pass
        buildings = [b for b in buildings if id(b) not in retired]
        log(f'lidar: {len(towers)} towers the footprints miss added, {len(retired)} slivers inside them retired')
    return buildings


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    slug = args[0] if args else 'sf'
    cfg = json.load(open(os.path.join(HERE, 'cities', f'{slug}.json')))
    if 'bbox' in flags:
        cfg['bbox'] = [float(v) for v in flags['bbox'].split(',')]
    out_dir = os.path.join(ROOT, 'public', 'city', flags.get('out', slug))
    os.makedirs(out_dir, exist_ok=True)
    lat0, lon0 = cfg['origin']
    proj = f'+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
    to_local = Transformer.from_crs('EPSG:4326', proj, always_xy=True)

    def ll2xz(lon, lat):
        e, n = to_local.transform(lon, lat)
        return e, -n

    lon_a, lat_a, lon_b, lat_b = cfg['bbox']
    xs, zs = zip(*[ll2xz(lo, la) for lo in (lon_a, lon_b) for la in (lat_a, lat_b)])
    minX, maxX = math.floor(min(xs) / TILE) * TILE, math.ceil(max(xs) / TILE) * TILE
    minZ, maxZ = math.floor(min(zs) / TILE) * TILE, math.ceil(max(zs) / TILE) * TILE
    log('city frame', minX, minZ, maxX, maxZ)

    # ---------------------------------------------------------------- DEM
    W = int((maxX - minX) / DEM_RES)
    H = int((maxZ - minZ) / DEM_RES)
    dem = np.full((H, W), np.nan, dtype=np.float32)
    # local frame raster: row 0 = minZ (north edge, since z = -northing), x right
    dst_transform = from_origin(minX, -minZ, DEM_RES, DEM_RES)  # in proj coords (northing = -z)
    if cfg.get('dem_fallback'):
        # coarser regional DEM first (Marin Headlands etc.), the 1 m city DEM on top
        os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
        with rasterio.open(cfg['dem_fallback']) as src:
            reproject(source=rasterio.band(src, 1), destination=dem, src_transform=src.transform, src_crs=src.crs,
                      src_nodata=src.nodata, dst_transform=dst_transform, dst_crs=proj, dst_nodata=np.nan,
                      resampling=Resampling.cubic, num_threads=2)
        log('dem fallback', int((~np.isnan(dem)).sum()))
    for path in cfg['dem']:
        with rasterio.open(path) as src:
            tmp = np.full((H, W), np.nan, dtype=np.float32)
            reproject(source=rasterio.band(src, 1), destination=tmp, src_transform=src.transform, src_crs=src.crs,
                      src_nodata=src.nodata, dst_transform=dst_transform, dst_crs=proj, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            m = ~np.isnan(tmp)
            dem[m] = tmp[m]
            log('dem', os.path.basename(path), int(m.sum()))
    if not cfg['dem'] and not cfg.get('dem_fallback'):
        dem[:] = float(cfg.get('groundLevel', 1.0))  # a flat city (no DEM): OSM's water is carved into it later
    nodata = np.isnan(dem)
    log('dem nodata fraction', float(nodata.mean()))
    # water = nodata; give it sea level, and smooth the coast a bit
    dem_filled = np.where(nodata, 0.0, dem).astype(np.float32)

    def dem_at(x, z):
        """bilinear sample of the local DEM at arrays x, z"""
        fx = (np.asarray(x) - minX) / DEM_RES - 0.5
        fz = (np.asarray(z) - minZ) / DEM_RES - 0.5
        fx = np.clip(fx, 0, W - 1.001)
        fz = np.clip(fz, 0, H - 1.001)
        ix = np.floor(fx).astype(int)
        iz = np.floor(fz).astype(int)
        tx = fx - ix
        tz = fz - iz
        a = dem_filled[iz, ix]
        b = dem_filled[iz, ix + 1]
        c = dem_filled[iz + 1, ix]
        d = dem_filled[iz + 1, ix + 1]
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz

    # ---------------------------------------------------------- structures
    use_osm = bool(cfg.get('overture'))
    osm = load_module('osm').OSM(cfg, slug, to_local, log) if use_osm else None
    if use_osm:
        osm.set_frame(minX, minZ, maxX, maxZ)
        # piers and quays out over the water: the bare-earth DEM has water there, the deck stands above it
        from rasterio.features import rasterize as _rz
        _, _, piers = osm.water()
        if piers:
            pm = _rz([(q, 1) for q in piers], out_shape=(H, W), transform=rasterio.Affine(DEM_RES, 0, minX, 0, DEM_RES, minZ), fill=0, dtype=np.uint8) > 0
            deck = float(osm.P.get('pierDeck', 2.5))
            low = pm & (nodata | (dem_filled < 0.5))  # (only out over the water: quays on land stay)
            dem_filled[low] = deck
            log(f'piers: {len(piers)} decks, {int(low.sum()) * DEM_RES * DEM_RES / 1e4:.1f} ha raised to {deck} m')
    df = None
    if cfg.get('structures') and os.path.exists(cfg['structures']):
        df = gpd.read_parquet(cfg['structures'])
        if 'FIPS' in df.columns and cfg.get('fips'):
            df = df[df['FIPS'] == cfg['fips']]
        df = df.cx[lon_a:lon_b, lat_a:lat_b]
        df = df.to_crs(proj)
        log('structures', len(df))
    elif not use_osm:
        raise SystemExit('no footprints: the city config needs "overture" or "structures"')

    usa_polys, usa_attrs = [], []
    for row in (df.itertuples(index=False) if df is not None else []):
        g = row.geometry
        if g is None or g.is_empty:
            continue
        parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        for k, p in enumerate(parts):
            if p.area < 12:
                continue
            # flip northing -> z (south positive)
            ext = np.asarray(p.exterior.coords)
            ext[:, 1] = -ext[:, 1]
            q = Polygon(ext)
            if not q.is_valid:
                q = q.buffer(0)
                if isinstance(q, MultiPolygon):
                    q = max(q.geoms, key=lambda a: a.area)
            q = shapely.simplify(q, 0.25, preserve_topology=True)
            if q.is_empty or q.area < 12:
                continue
            h = float(row.HEIGHT) if row.HEIGHT == row.HEIGHT and row.HEIGHT is not None else float('nan')
            usa_polys.append(q)
            usa_attrs.append({
                'id': int(row.BUILD_ID) * 4 + k,
                'occ': str(row.OCC_CLS or ''),
                'prim': str(row.PRIM_OCC or ''),
                'h': h,
            })
    log('polygons', len(usa_polys))

    # ---------------------------------------------- OpenStreetMap footprints (conflated)
    from scipy.spatial import cKDTree
    osm_b, parts_of, counts = [], None, {}
    if use_osm:
        osm_b = osm.buildings()
        parts_of = osm.parts()
        for b in osm_b:
            b['poly'] = shapely.geometry.polygon.orient(b['poly'], 1.0)
        counts['osm'] = sum(b['src'] == 'osm' for b in osm_b)
        counts['ovt'] = sum(b['src'] == 'ovt' for b in osm_b)
        if usa_polys:
            best, best_f, usa_cov = osm.conflate([b['poly'] for b in osm_b], usa_polys)
        else:
            best, best_f, usa_cov = np.full(len(osm_b), -1), np.zeros(len(osm_b)), np.zeros(0)
        # USA Structures only where OSM has nothing (less than a quarter of the row under OSM footprints)
        keep_usa = [i for i in range(len(usa_polys)) if usa_cov[i] < 0.25]
        counts['usaRows'] = len(keep_usa)
        counts['usaArea'] = float(sum(usa_polys[i].area for i in keep_usa))
        counts['osmArea'] = float(sum(b['poly'].area for b in osm_b))
        log(f'conflation: {len(osm_b)} OSM/Overture footprints; {len(keep_usa)} of {len(usa_polys)} USA Structures rows have no '
            f'OSM footprint ({counts["usaArea"] / max(1.0, counts["usaArea"] + counts["osmArea"]) * 100:.1f} % of the built area): fallback')
        # occupancy: OSM's class / subtype, else the USA Structures row under it
        occ_of = {'house': 'Residential', 'detached': 'Residential', 'semidetached_house': 'Residential', 'terrace': 'Residential',
                  'apartments': 'Residential', 'residential': 'Residential', 'bungalow': 'Residential', 'dormitory': 'Residential',
                  'commercial': 'Commercial', 'retail': 'Commercial', 'office': 'Commercial', 'hotel': 'Commercial', 'supermarket': 'Commercial',
                  'warehouse': 'Industrial', 'industrial': 'Industrial', 'service': 'Industrial', 'transportation': 'Industrial',
                  'school': 'Education', 'university': 'Education', 'college': 'Education', 'kindergarten': 'Education', 'education': 'Education',
                  'civic': 'Government', 'government': 'Government', 'public': 'Government', 'fire_station': 'Government', 'military': 'Government',
                  'church': 'Assembly', 'cathedral': 'Assembly', 'chapel': 'Assembly', 'religious': 'Assembly', 'temple': 'Assembly',
                  'mosque': 'Assembly', 'synagogue': 'Assembly', 'entertainment': 'Assembly', 'stadium': 'Assembly', 'sports_hall': 'Assembly',
                  'hospital': 'Commercial', 'medical': 'Commercial', 'garage': 'Outbuilding', 'garages': 'Outbuilding', 'shed': 'Outbuilding',
                  'carport': 'Outbuilding', 'hut': 'Outbuilding', 'outbuilding': 'Outbuilding', 'cabin': 'Outbuilding', 'greenhouse': 'Outbuilding'}
        nsrc = defaultdict(int)
        for i, b in enumerate(osm_b):
            u = int(best[i]) if best_f[i] >= 0.3 else -1
            b['usa'] = u
            b['occ'] = occ_of.get(b['cls']) or occ_of.get(b['subtype']) or (usa_attrs[u]['occ'] if u >= 0 else '')
            b['prim'] = usa_attrs[u]['prim'] if u >= 0 else ''
            # height before the LiDAR: OSM height, else floors, else the USA Structures row (where it covers this footprint)
            if b['h'] is not None and b['h'] > 2.0:
                b['hsrc'] = 'osm'
            elif b['floors']:
                b['h'], b['hsrc'] = b['floors'] * 3.2 + 1.0, 'floors'
            elif u >= 0 and best_f[i] >= 0.4 and usa_attrs[u]['h'] == usa_attrs[u]['h'] and usa_attrs[u]['h'] > 2.0:
                b['h'], b['hsrc'] = usa_attrs[u]['h'], 'usa'
            else:
                b['h'], b['hsrc'] = float('nan'), None
        cent_o = np.array([[b['poly'].centroid.x, b['poly'].centroid.y] for b in osm_b]) if osm_b else np.zeros((0, 2))
        hs_o = np.array([b['h'] for b in osm_b], dtype=np.float64)
        known_o = ~np.isnan(hs_o)
        kt_o = cKDTree(cent_o[known_o]) if known_o.any() else None
        defaults = {'Outbuilding': 3.2, 'Residential': 8.0, 'Commercial': 8.0, 'Industrial': 7.0, 'Assembly': 10.0, 'Government': 10.0, 'Education': 9.0}
        for i in np.where(~known_o)[0]:
            b = osm_b[i]
            idx = kt_o.query_ball_point(cent_o[i], 40.0) if kt_o is not None else []
            if idx and b['occ'] != 'Outbuilding':
                b['h'], b['hsrc'] = float(np.median(hs_o[known_o][idx])), 'neighbors'
            else:
                b['h'], b['hsrc'] = defaults.get(b['occ'], 6.0), 'default'
            if b['poly'].area < 400:
                b['h'] = min(b['h'], 14.0)
            b['h'] = max(3.0, b['h'])
        for b in osm_b:
            nsrc[b['hsrc']] += 1
        log('heights before the LiDAR: ' + ', '.join(f'{k} {v}' for k, v in sorted(nsrc.items())))
        polys = [usa_polys[i] for i in keep_usa]
        attrs = [usa_attrs[i] for i in keep_usa]
    else:
        polys, attrs = usa_polys, usa_attrs

    # ------------------------------------------------------------- LiDAR rooftops
    lidar_rasters = None
    if cfg.get('lidar') and flags.get('lidar', '1') != '0':
        lidar = load_lidar_module()
        if df is not None:
            fine_ch, coarse_ch = lidar.plan_chunks(cfg, df.geometry.values, df['HEIGHT'].astype(float).values, proj)
        else:
            fine_ch, coarse_ch = set(), set()
        frame = lidar.Frame(proj, minX, minZ, maxX, maxZ)
        lidar_rasters = lidar.build_rasters(dict(cfg, slug=slug), frame, set(), coarse_ch, log=log)
        # the 1 m plan also covers tall roofs the footprint heights don't know about
        extra = lidar.tall_chunks(lidar_rasters['coarse'], dem_at, fine_ch)
        log(f'lidar: {len(extra)} more 1 m chunks where the 2 m raster sees tall roofs the footprints miss')
        fine_r = lidar.build_rasters(dict(cfg, slug=slug), frame, fine_ch | extra, set(), log=log)
        lidar_rasters.update(fine=fine_r['fine'], fineLow=fine_r['fineLow'])
        if use_osm and osm_b:
            # chunks only the OSM footprints need (the plan above is the USA Structures one, so its rasters stay cached)
            flip = lambda q: Polygon(np.asarray(q.exterior.coords) * [1.0, -1.0])
            f_o, c_o = lidar.plan_chunks(cfg, [flip(b['poly']) for b in osm_b], np.array([b['h'] for b in osm_b], dtype=np.float64), proj)
            f_x, c_x = f_o - (fine_ch | extra), c_o - coarse_ch
            if f_x or c_x:
                log(f'lidar: {len(c_x)} more 2 m and {len(f_x)} more 1 m chunks for OSM footprints')
                more = lidar.build_rasters(dict(cfg, slug=slug), frame, f_x, c_x, log=log)
                for k in ('coarse', 'coarseLow', 'fine', 'fineLow'):
                    lidar_rasters[k].update(more.get(k, {}))
        massing = Massing(cfg['lidar'].get('massing'), lidar.Heights(lidar_rasters), dem_at, lidar.NODATA)

    # fill missing heights from neighbors (median within 40 m), else occupancy default
    cent = np.array([[p.centroid.x, p.centroid.y] for p in polys]) if polys else np.zeros((0, 2))
    hs = np.array([a['h'] for a in attrs], dtype=np.float64)
    known = ~np.isnan(hs) & (hs > 2.0)
    kt = cKDTree(cent[known]) if known.any() else None
    for i in np.where(~known)[0]:
        idx = kt.query_ball_point(cent[i], 40.0) if kt is not None else []
        if idx:
            hs[i] = float(np.median(hs[known][idx]))
        else:
            hs[i] = 7.5 if attrs[i]['occ'] == 'Residential' else 6.0
        attrs[i]['h'] = max(3.0, min(hs[i], 14.0) if polys[i].area < 400 else hs[i])
    for i in np.where(known)[0]:
        attrs[i]['h'] = float(hs[i])

    # -------------------------------------------------- blocks (street walls)
    segs = None
    if use_osm:
        # fronts face the real streets: an edge whose outward side looks at a street centerline no farther than
        # a front yard beyond the curb (row houses: the street end; corners: both; party walls: neither)
        O = load_module('osm')
        segs = osm.segments()
        rl = [(ln, w) for ln, k, w, _, c in segs if k in (O.PAVED, O.PLAZA) and c not in ('service', 'track')]
        road_geoms = np.array([ln for ln, _ in rl], dtype=object)
        road_half = np.array([w / 2.0 for _, w in rl])
        road_tree = STRtree(road_geoms)

        front_cache = {}

        def frontage_batch(plist):
            """Street-facing edges of many polygons at once (one nearest-street query for all their edges)."""
            plist = [p for p in plist if id(p) not in front_cache]
            if not plist:
                return
            rings = [np.asarray(p.exterior.coords)[:-1] for p in plist]
            cnt = np.array([len(r) for r in rings])
            for p in plist:
                front_cache[id(p)] = (p, [])
            if not len(road_geoms) or not cnt.sum():
                return
            a = np.concatenate(rings)
            b2 = np.concatenate([np.roll(r, -1, axis=0) for r in rings])
            owner = np.repeat(np.arange(len(plist)), cnt)
            local = np.concatenate([np.arange(n) for n in cnt])
            cr = a[:, 0] * b2[:, 1] - b2[:, 0] * a[:, 1]
            sgn = np.where(np.bincount(owner, weights=cr, minlength=len(plist)) > 0, 1.0, -1.0)[owner]
            d = b2 - a
            L = np.hypot(d[:, 0], d[:, 1])
            nrm = np.column_stack([d[:, 1], -d[:, 0]]) / np.maximum(L, 1e-9)[:, None] * sgn[:, None]
            mids = (a + b2) * 0.5
            pts = shapely.points(mids + nrm * 0.3)
            (ii, jj), _ = road_tree.query_nearest(pts, max_distance=30.0, return_distance=True, all_matches=False)
            ends = shapely.get_coordinates(shapely.get_point(shapely.shortest_line(pts[ii], road_geoms[jj]), 1))
            v = ends - mids[ii]
            vl = np.hypot(v[:, 0], v[:, 1])
            ok = (L[ii] >= 3.0) & (vl > 1e-6) & ((v * nrm[ii]).sum(axis=1) >= 0.7 * vl) & (vl - road_half[jj] <= 14.0)
            for k in np.argsort(-L[ii][ok], kind='stable'):
                e = ii[ok][k]
                front_cache[id(plist[owner[e]])][1].append(int(local[e]))

        def frontage_edges(p):
            """edges of polygon p that face a street (the street ahead of them, within a front yard), longest first"""
            if id(p) not in front_cache or front_cache[id(p)][0] is not p:
                front_cache.pop(id(p), None)
                frontage_batch([p])
            return list(front_cache[id(p)][1])
    else:
        log('closing blocks')
        closed = shapely.unary_union([p.buffer(9.0, join_style='mitre', mitre_limit=2.0) for p in polys])
        closed = closed.buffer(-9.0, join_style='mitre', mitre_limit=2.0)
        block_geoms = list(closed.geoms) if isinstance(closed, MultiPolygon) else [closed]
        block_rings = [shapely.LineString(b.exterior.coords) for b in block_geoms if not b.is_empty]
        ring_tree = STRtree(block_rings)
        log('blocks', len(block_rings))

        def frontage_edges(p):
            """edges of polygon p that lie on a block's street wall, longest first"""
            c = np.asarray(p.exterior.coords)[:-1]
            n = len(c)
            mids = [(c[i] + c[(i + 1) % n]) * 0.5 for i in range(n)]
            pts = shapely.points(np.array(mids))
            near = ring_tree.query_nearest(pts, max_distance=3.0, return_distance=True)
            on = set(int(i) for i in near[0][0])
            edges = []
            for i in range(n):
                a, b = c[i], c[(i + 1) % n]
                L = float(np.hypot(*(b - a)))
                if i in on and L >= 4.0:
                    edges.append((L, i))
            edges.sort(reverse=True)
            return [i for _, i in edges]

    # ------------------------------------------------------- split rows into lots
    LOT_WIDTHS = [6.1, 7.0, 7.6, 7.6, 7.6, 7.6, 8.2, 8.5, 9.1, 10.0, 7.6, 7.3]

    def ring_ccw(p):
        p = shapely.geometry.polygon.orient(p, sign=1.0)
        return p

    def split_row(p, a, seed):
        """Cut a merged row of attached houses into lots along its street frontages."""
        p = ring_ccw(p)
        c = np.asarray(p.exterior.coords)[:-1]
        n = len(c)
        fronts = frontage_edges(p)
        if not fronts:
            return [(p, None)]
        rnd = Rand(seed)
        lots = []
        taken = None
        depth_max = 26.0
        for ei in fronts[:3]:
            A, B = c[ei], c[(ei + 1) % n]
            e = B - A
            L = float(np.hypot(*e))
            if L < 9.0:
                continue
            u = e / L
            # inward normal for a CCW ring in (x, z): rotate edge by +90 deg -> (-uz, ux)
            # (shapely orient(sign=1) gives CCW in a y-up frame; our z is flipped, so test it)
            nrm = np.array([-u[1], u[0]])
            probe = shapely.Point(*(A + u * L * 0.5 + nrm * 1.0))
            if not p.contains(probe):
                nrm = -nrm
            t = 0.0
            widths = []
            while t < L - 0.5:
                w = LOT_WIDTHS[int(rnd.next() * len(LOT_WIDTHS))]
                if rnd.next() < 0.08:
                    w *= 2.0  # an occasional double lot (apartment flats)
                if L - (t + w) < 4.5:
                    w = L - t
                widths.append((t, min(L, t + w)))
                t += w
            for (t0, t1) in widths:
                q0 = A + u * t0
                q1 = A + u * t1
                quad = Polygon([q0, q1, q1 + nrm * depth_max, q0 + nrm * depth_max])
                try:
                    piece = p.intersection(quad)
                    if taken is not None:
                        piece = shapely.make_valid(piece).difference(taken)
                except shapely.errors.GEOSException:
                    continue
                if piece.is_empty:
                    continue
                if isinstance(piece, MultiPolygon) or piece.geom_type == 'GeometryCollection':
                    cands = [g for g in getattr(piece, 'geoms', []) if g.geom_type == 'Polygon']
                    if not cands:
                        continue
                    piece = max(cands, key=lambda g: g.area)
                if piece.area < 20:
                    continue
                piece = shapely.make_valid(piece)
                if piece.geom_type != 'Polygon':
                    continue
                lots.append((piece, ei))
                try:
                    taken = piece if taken is None else shapely.make_valid(taken.union(piece))
                except shapely.errors.GEOSException:
                    taken = shapely.make_valid(shapely.unary_union([taken.buffer(0), piece.buffer(0)]))
        if not lots:
            return [(p, None)]
        try:
            rest = p.difference(taken)
        except shapely.errors.GEOSException:
            rest = shapely.make_valid(p).difference(shapely.make_valid(taken).buffer(0))
        if not rest.is_empty:
            rparts = list(rest.geoms) if hasattr(rest, 'geoms') else [rest]
            for r in rparts:
                if r.geom_type != 'Polygon':
                    continue
                if r.area >= 45:
                    lots.append((r, None))
                else:
                    # glue small leftovers onto the lot they touch most
                    best, bi = 0, -1
                    for li, (lp, _) in enumerate(lots):
                        s = lp.buffer(0.3).intersection(r).area
                        if s > best:
                            best, bi = s, li
                    if bi >= 0:
                        try:
                            merged = shapely.make_valid(lots[bi][0]).union(shapely.make_valid(r).buffer(0.05)).buffer(-0.05)
                        except shapely.errors.GEOSException:
                            continue
                        if merged.geom_type == 'Polygon':
                            lots[bi] = (merged, lots[bi][1])
        return lots

    def district_style(x, z):
        lon, lat = to_local.transform(x, -z, direction='INVERSE')
        for d in cfg.get('districts', []):
            if d['lon'][0] <= lon <= d['lon'][1] and d['lat'][0] <= lat <= d['lat'][1]:
                return d['style']
        return 'victorian'

    hood_ll = cfg.get('neighborhoods', [])
    hood_xz = np.array([ll2xz(lo, la) for _, la, lo in hood_ll]) if hood_ll else np.zeros((0, 2))
    hood_tree = cKDTree(hood_xz) if len(hood_xz) else None

    log('splitting rows into lots')
    # Merged rows can carry a block-wide height (e.g. a whole Victorian block at 23 m).
    # Prefer the median of nearby small, single-house footprints for big merged rows.
    areas = np.array([p.area for p in polys])
    small = (areas < 400) & np.array([a['occ'] == 'Residential' for a in attrs], dtype=bool) & ~np.isnan(hs) & (hs > 3)
    small_tree = cKDTree(cent[small]) if small.any() else None
    small_h = hs[small]
    buildings = []  # dicts
    for i, (p, a) in enumerate(zip(polys, attrs)):
        h = a['h']
        occ = a['occ']
        residentialish = occ in ('Residential', 'Unclassified', '')
        if residentialish and p.area > 1200 and small_tree is not None:
            idx = small_tree.query_ball_point(cent[i], 160.0)
            if len(idx) >= 4:
                h = min(h, float(np.median(small_h[idx])) * 1.08)
        can_split = residentialish and h < 30.0 and p.area > 150.0
        pieces = split_row(p, a, a['id']) if can_split else [(ring_ccw(p), None)]
        rnd = Rand(hash32(a['id'], 7))
        for k, (q, fe) in enumerate(pieces):
            q = ring_ccw(q)
            q = shapely.simplify(q, 0.2, preserve_topology=True)
            if q.is_empty or q.geom_type != 'Polygon' or q.area < 15:
                continue
            hh = h
            if len(pieces) > 1:
                hh = h * (0.86 + 0.28 * rnd.next())
                if rnd.next() < 0.12:
                    hh *= 0.78  # the odd two-story among three-story neighbors
            buildings.append({'poly': q, 'h': max(3.0, hh), 'occ': occ, 'prim': a['prim'],
                              'srckey': (a['id'], k), 'front_edge_hint': fe, 'src': 'usa', 'key': f"u{a['id']}:{k}",
                              'hsrc': 'usa' if a['h'] == a['h'] else 'neighbors'})
    log('buildings after split', len(buildings))
    ids = None
    if use_osm:
        counts['usaLots'] = len(buildings)
        # the OSM footprints (no lot splitting: they are the real lots); srckeys unique per footprint, after the
        # fallback rows' (USA BUILD_ID * 4 + part), so no OSM footprint ever merges with another
        base_key = max([b['srckey'][0] for b in buildings], default=0) + 1
        for i, ob in enumerate(osm_b):
            buildings.append({'poly': ob['poly'], 'holes': ob['holes'], 'h': ob['h'], 'hsrc': ob['hsrc'], 'occ': ob['occ'],
                              'prim': ob['prim'], 'srckey': (base_key + i, 0), 'front_edge_hint': None, 'src': ob['src'],
                              'key': ob['key'], 'gers': ob['gers'], 'hasParts': ob['hasParts'], 'roof': ob['roof'],
                              'facadeColor': ob['facadeColor'], 'roofColor': ob['roofColor'], 'facadeMat': ob['facadeMat'],
                              'roofMat': ob['roofMat'], 'osmClass': ob['cls'] or ob['subtype'], 'minH': ob['minH'], 'name': ob['name']})
        # stable ids from what each building is (see ID_RANGES): never a rank
        ids = IdAlloc()
        for b in sorted(buildings, key=lambda b: (b['src'], b['key'])):
            b['stable'] = ids.take(b['src'], b['key'])
        log(f'stable ids: {len(buildings)} from source ids ({ids.collisions} hash collisions probed)')
    else:
        # stable ids: rank in (source id, lot) order. Unique by construction, and
        # stable across re-bakes of the same source data (the paint array keys on it).
        for rank, b in enumerate(sorted(buildings, key=lambda b: b['srckey'])):
            b['stable'] = rank
    # Everything below may change heights, merge lots, split blocks and add tiers, but never
    # the ids above (see lidar_pass for the ids of buildings a LiDAR bake adds).

    # landmarks are hand-built props: footprints under them stay low (no doubled towers)
    for b in buildings:
        b['parts'] = None
        cx, cz = b['poly'].centroid.x, b['poly'].centroid.y
        for lm in cfg.get('landmarks', []):
            if lm.get('clearRadius'):
                lx, lz = ll2xz(lm['lon'], lm['lat'])
                if math.hypot(cx - lx, cz - lz) < float(lm['clearRadius']):
                    b['h'] = min(b['h'], float(lm.get('clearHeight', 8.0)))
                    b['landmark'] = True

    if lidar_rasters is not None:
        buildings = lidar_pass(buildings, cfg, massing, lidar_rasters['fine'], ll2xz, dem_at, log, ids=ids, parts_of=parts_of)
    elif parts_of:
        # no LiDAR to check them against: the mapped parts are the massing
        npu = 0
        for b in buildings:
            if not b.get('landmark') and b.get('hasParts') and b.get('gers') in parts_of:
                recs = parts_massing(b, parts_of[b['gers']])
                if recs:
                    b['osmParts'] = recs
                    npu += 1
        log(f'osm parts: {npu} buildings take their massing from OSM building parts (no LiDAR)')

    def ground_stats(p):
        return ground_stats_at(dem_at, p)

    # ------------------------------------------------------- ground classes (OSM)
    ground = None
    if use_osm:
        log('ground classes')
        bpolys = [with_holes(b) for b in buildings]
        bres = [b['occ'] in ('Residential', 'Unclassified', '', 'Outbuilding') for b in buildings]
        ground, pier_mask, treeable = osm.ground_raster(H, W, minX, minZ, DEM_RES, nodata, dem_filled, bpolys, bres, segs)
        if not cfg['dem'] and not cfg.get('dem_fallback'):
            # a flat city: the water sits a step below the quays
            dem_filled[ground == O.WATER] = float(cfg.get('waterLevel', -0.8))
        del bpolys, bres

    # ---------------------------------------------------------- classify + ground
    log('classifying')

    def fronts_of(p):
        c = np.asarray(p.exterior.coords)[:-1]
        fronts = frontage_edges(p)
        f1 = fronts[0] if fronts else 255
        f2 = 255
        if len(fronts) > 1:
            # second frontage only if roughly perpendicular (a corner house)
            e0 = c[(fronts[0] + 1) % len(c)] - c[fronts[0]]
            e1 = c[(fronts[1] + 1) % len(c)] - c[fronts[1]]
            cosang = abs(np.dot(e0, e1)) / (np.linalg.norm(e0) * np.linalg.norm(e1) + 1e-9)
            if cosang < 0.4:
                f2 = fronts[1]
        return min(255, f1), min(255, f2)

    hood_names = [n for n, _, _ in cfg.get('neighborhoods', [])]
    hood_label = [ll2xz(lo, la) for _, la, lo in cfg.get('neighborhoods', [])]
    hoods_b = None
    if use_osm:
        names, pts, hpolys = osm.hoods(extra=[(n, *ll2xz(lo, la)) for n, la, lo in cfg.get('neighborhoods', [])])
        hood_index = O.HoodIndex(names, pts, hpolys)
        hood_names, hood_label = names, [(x, z) for x, z, _ in pts]
        bc = np.array([[b['poly'].centroid.x, b['poly'].centroid.y] for b in buildings])
        hoods_b = hood_index.at(bc[:, 0], bc[:, 1]) if len(bc) else np.zeros(0, np.int64)
        log(f'neighbourhoods: {len(names)} names ({len(hpolys)} mapped areas)')
    hood_tree = cKDTree(np.array(hood_label)) if hood_label else None
    roof_defaults = {k: O.ROOF_SHAPES.get(v, 0) for k, v in osm.P['roofDefaults'].items()} if use_osm else {}

    def seed_for(b):
        """The per-building seed (window jitter, grey tone...). A mapped facade colour picks a seed whose grey
        tone (buildingMaterial: (fract(seed * 0.61803) - 0.5) * 0.12) follows the colour's lightness: in the grey
        city colours only shift value."""
        base = hash32(b['stable']) & 0xFF
        col = b.get('facadeColor', 0)
        if not col:
            return base
        L = float(np.clip(O.luminance(col), 0.05, 0.95))
        cands = [k for k in range(256) if abs(((k * 0.61803) % 1.0) - L) < 0.03]
        return cands[hash32(b['stable'], 5) % len(cands)] if cands else base

    if use_osm:
        # every footprint's and part's street-facing edges in one batch (a query per polygon took minutes)
        frontage_batch([b['poly'] for b in buildings] + [r['poly'] for b in buildings for r in (b.get('osmParts') or [])]
                       + [ring_ccw(t[0]) for b in buildings if b.get('parts') and not b.get('osmParts') for t in b['parts'][1:]])
    nroof = defaultdict(int)
    for bi, b in enumerate(buildings):
        p = b['poly']
        c = np.asarray(p.exterior.coords)[:-1]
        gmin, gmean = ground_stats(p)
        b['baseY'] = gmin - 0.4
        b['roofY'] = gmean + b['h']
        b['front'], b['front2'] = fronts_of(p)
        none = {'roofShape': 0, 'roofH': 0.0, 'roofDir': 0}
        cols = {'facadeColor': b.get('facadeColor', 0), 'roofColor': b.get('roofColor', 0), 'facadeMat': b.get('facadeMat', 0), 'roofMat': b.get('roofMat', 0)}
        # parts: the footprint (tier 0), then LiDAR tiers stacked on the tier below; or OSM's building parts
        if b.get('osmParts'):
            parts = []
            for r in b['osmParts']:
                q = r['poly']
                f1, f2 = fronts_of(q)
                base = b['baseY'] if r['tier'] == 0 else gmin + r['base']
                shape, R, rdir, eave = roof_for(q, r['roof'], gmin + r['top'], base, False)
                parts.append({'poly': q, 'baseY': base, 'roofY': max(eave, base + 1.0), 'tier': r['tier'], 'front': f1, 'front2': f2, 'taper': 0,
                              'roofShape': shape, 'roofH': R, 'roofDir': rdir,
                              'facadeColor': r['facadeColor'] or cols['facadeColor'], 'roofColor': r['roofColor'] or cols['roofColor'],
                              'facadeMat': r['facadeMat'] or cols['facadeMat'], 'roofMat': r['roofMat'] or cols['roofMat']})
                nroof[shape] += 1
            b['parts'] = parts
            b['roofY'] = max(q['roofY'] + q['roofH'] for q in parts)
            b['h'] = b['roofY'] - gmean
        elif b['parts']:
            parts = []
            for q, top, tier, par, sc in b['parts']:
                taper = int(round((1.0 - sc) * 255))
                if tier == 0:
                    parts.append(dict({'poly': p, 'baseY': b['baseY'], 'roofY': max(top, gmean + 3.0), 'tier': 0, 'front': b['front'], 'front2': b['front2'], 'taper': taper}, **none, **cols))
                    continue
                q = ring_ccw(q)
                f1, f2 = fronts_of(q)
                base = parts[par]['roofY']
                parts.append(dict({'poly': q, 'baseY': base, 'roofY': max(top, base + 2.0), 'tier': tier, 'front': f1, 'front2': f2, 'taper': taper}, **none, **cols))
            b['parts'] = parts
            b['roofY'] = max(q['roofY'] for q in parts)
            b['h'] = b['roofY'] - gmean
        else:
            roof = dict(b.get('roof') or {})
            if not roof.get('shape') and roof_defaults and p.area < 400 and roof_defaults.get(b.get('osmClass', '')):
                roof['shape'] = roof_defaults[b['osmClass']]
            if b.get('landmark'):
                roof = {}
            shape, R, rdir, eave = roof_for(p, roof, b['roofY'], b['baseY'], b.get('hsrc') == 'lidar')
            b['parts'] = [dict({'poly': p, 'baseY': b['baseY'], 'roofY': max(eave, b['baseY'] + 2.0), 'tier': 0, 'front': b['front'], 'front2': b['front2'], 'taper': 0,
                                'roofShape': shape, 'roofH': R, 'roofDir': rdir}, **cols)]
            nroof[shape] += 1
            b['roofY'] = b['parts'][0]['roofY'] + R
            b['h'] = b['roofY'] - gmean
        if b.get('holes') and len(b['parts']) == 1:
            # courtyards: the footprint is cut through them into pieces, all tier 0 (the first keeps the front),
            # flat-roofed (a pitched roof over a ring of pieces would cross the courtyard)
            pcs = [ring_ccw(q) for q in O.OSM.pieces(with_holes(b))]
            if len(pcs) > 1:
                t0 = b['parts'][0]
                ex = []
                for q in pcs:
                    f1, f2 = fronts_of(q)
                    ex.append(dict(t0, poly=q, front=f1, front2=f2, roofShape=1 if t0['roofShape'] else 0, roofH=0.0, roofDir=0, taper=0))
                b['parts'] = ex
                b['roofY'] = t0['roofY']
                b['h'] = b['roofY'] - gmean
                b['cut'] = True
        # frontage width
        if b['front'] != 255:
            a0 = c[b['front']]
            a1 = c[(b['front'] + 1) % len(c)]
            fw = float(np.hypot(*(a1 - a0)))
        else:
            mrr = p.minimum_rotated_rectangle
            cc = np.asarray(mrr.exterior.coords)
            fw = float(min(np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1]))))
        h = b['h']
        occ = b['occ']
        style = district_style(p.centroid.x, p.centroid.y)
        if h >= 38:
            arch = 'tower'
        elif occ in ('Commercial', 'Industrial') and h >= 5:
            arch = 'commercial'
        elif occ in ('Government', 'Assembly', 'Education'):
            arch = 'civic' if h >= 9 else 'commercial'
        elif occ == 'Outbuilding':
            arch = 'shed' if h < 6.0 else 'commercial'
        elif h < 4.2 or p.area < 30:
            arch = 'shed'
        elif h >= 17 or fw > 14 or p.area > 900:
            arch = 'flats'
        else:
            arch = style if style in ('stucco', 'marina') else 'victorian'
        b['arch'] = ARCH[arch]
        floor_h = 3.6 if arch == 'victorian' else (3.1 if arch in ('stucco', 'marina') else 3.3)
        b['floors'] = int(max(1, min(250, round(h / floor_h))))
        if hoods_b is not None:
            b['hood'] = int(min(254, hoods_b[bi]))
        elif hood_tree is not None:
            b['hood'] = int(hood_tree.query([p.centroid.x, p.centroid.y])[1])
        else:
            b['hood'] = 0
        b['seed'] = seed_for(b) if use_osm else hash32(b['stable']) & 0xFF
    if use_osm:
        names_r = {v: k for k, v in reversed(list(O.ROOF_SHAPES.items()))}  # (the first name of each code)
        log('roof shapes (parts): ' + ', '.join(f'{names_r.get(k, "untagged") if k else "untagged"} {v}' for k, v in sorted(nroof.items())))
        counts['roofShapes'] = {(names_r.get(k, '?') if k else 'untagged'): v for k, v in nroof.items()}

    # stable dense index: sort by tile then by stable id
    for b in buildings:
        b['tx'] = int(math.floor(b['poly'].centroid.x / TILE))
        b['tz'] = int(math.floor(b['poly'].centroid.y / TILE))
    buildings.sort(key=lambda b: (b['tz'], b['tx'], b['stable']))
    for i, b in enumerate(buildings):
        b['index'] = i

    # ----------------------------------------------------------- ground class
    log('ground classes + trees')
    shapes = [(with_holes(b), 1) for b in buildings]
    from rasterio.features import rasterize
    # rasterize in local frame: transform maps (col,row) -> (x, z) via proj coords; use z directly
    local_transform = rasterio.Affine(DEM_RES, 0, minX, 0, DEM_RES, minZ)
    cov = rasterize(shapes, out_shape=(H, W), transform=local_transform, fill=0, dtype=np.uint8).astype(bool)
    dist = (ndimage.distance_transform_edt(~cov) * DEM_RES).astype(np.float32)
    if ground is None:
        water = nodata | (dem_filled < 0.3)
        water = ndimage.binary_opening(water, iterations=2)
        grass = (dist > 17.0) & ~water
        grass = ndimage.binary_opening(grass, iterations=2)
        ground = np.zeros((H, W), dtype=np.uint8)
        # sidewalks: a 3.5 m band in front of buildings that isn't grass or water
        ground[(dist > 0) & (dist <= 3.6)] = GROUND_SIDEWALK
        ground[cov] = GROUND_SIDEWALK
        ground[grass] = GROUND_GRASS
        ground[water] = GROUND_WATER
        treeable = None
    del cov

    def ground_at(x, z):
        ix = np.clip(((np.asarray(x) - minX) / DEM_RES).astype(int), 0, W - 1)
        iz = np.clip(((np.asarray(z) - minZ) / DEM_RES).astype(int), 0, H - 1)
        return ground[iz, ix], dist[iz, ix]

    # trees: (OSM) every mapped tree; park trees on a jittered grid in grass (OSM: only inside real parks,
    # woods and cemeteries, not on pitches or fairways; denser in woods), street trees along frontages
    trees = []
    real = []
    if use_osm:
        real = [(x, z, k, s) for x, z, k, s in osm.trees() if minX <= x < maxX and minZ <= z < maxZ]
        rcl, _ = ground_at([t[0] for t in real], [t[1] for t in real])
        real = [t for t, c in zip(real, rcl) if c != O.WATER]
        trees += [(float(x), float(z), float(s), int(k)) for x, z, k, s in real]
    real_tree = cKDTree(np.array([[t[0], t[1]] for t in real])) if real else None
    rng = np.random.default_rng(1234)
    gx = np.arange(minX + 5, maxX, 11.0)
    gz = np.arange(minZ + 5, maxZ, 11.0)
    GX, GZ = np.meshgrid(gx, gz)
    GX = GX + rng.uniform(-4.5, 4.5, GX.shape)
    GZ = GZ + rng.uniform(-4.5, 4.5, GZ.shape)
    cls, dd = ground_at(GX.ravel(), GZ.ravel())
    # no forests on steep grassy hills (Twin Peaks, Bernal, the Marin Headlands are bare)
    gxr, gzr = GX.ravel(), GZ.ravel()
    sx_ = (dem_at(gxr + 6, gzr) - dem_at(gxr - 6, gzr)) / 12
    sz_ = (dem_at(gxr, gzr + 6) - dem_at(gxr, gzr - 6)) / 12
    slope = np.hypot(sx_, sz_)
    tree_lat_max = cfg.get('treeLatMax', 90)
    _, lat_r = to_local.transform(gxr, -gzr, direction='INVERSE')
    u = rng.uniform(size=cls.shape)
    if treeable is not None:
        ix = np.clip(((gxr - minX) / DEM_RES).astype(int), 0, W - 1)
        iz = np.clip(((gzr - minZ) / DEM_RES).astype(int), 0, H - 1)
        tz_ = treeable[iz, ix]
        keep = (((tz_ == 1) & (u < 0.55)) | ((tz_ == 2) & (u < 0.85))) & np.isin(cls, (O.GRASS, O.FOREST)) & (dd > 12) & (slope < 0.2) & (lat_r < tree_lat_max)
        if real_tree is not None:
            nd_, _ = real_tree.query(np.column_stack([gxr, gzr]))
            keep &= nd_ > 7.0  # a mapped tree stands here already
    else:
        keep = (cls == GROUND_GRASS) & (dd > 20) & (u < 0.55) & (slope < 0.2) & (lat_r < tree_lat_max)
    for x, z in zip(GX.ravel()[keep], GZ.ravel()[keep]):
        kind = 2 if rng.uniform() < 0.18 else 1
        trees.append((float(x), float(z), 0.75 + 0.7 * rng.uniform(), kind))
    nstreet = 0
    for b in buildings:
        if b['front'] == 255 or b['arch'] not in (ARCH['victorian'], ARCH['flats'], ARCH['stucco'], ARCH['marina']):
            continue
        rr = Rand(hash32(b['stable'], 99))
        if rr.next() > 0.3:
            continue
        p = b['poly']
        c = np.asarray(p.exterior.coords)[:-1]
        i0 = b['front']
        A, B = c[i0], c[(i0 + 1) % len(c)]
        e = B - A
        L = float(np.hypot(*e))
        if L < 3:
            continue
        u = e / L
        nrm = np.array([-u[1], u[0]])
        mid = A + u * L * (0.3 + 0.4 * rr.next())
        if p.contains(shapely.Point(*(mid + nrm * 0.8))):
            nrm = -nrm
        pt = mid + nrm * 3.2
        cl, dd1 = ground_at([pt[0]], [pt[1]])
        if use_osm:
            # on the sidewalk, and not where the mapped street trees already stand
            if cl[0] not in (O.SIDEWALK, O.YARD) or dd1[0] <= 2.0 or (real_tree is not None and real_tree.query(pt)[0] < 9.0):
                continue
        elif not (cl[0] == GROUND_PAVED and dd1[0] > 2.0):
            continue
        trees.append((float(pt[0]), float(pt[1]), 0.55 + 0.35 * rr.next(), 0))
        nstreet += 1
    log(f'trees {len(trees)} ({len(real)} mapped, {nstreet} along frontages, the rest in parks)')
    counts['trees'] = {'mapped': len(real), 'street': nstreet, 'park': len(trees) - len(real) - nstreet} if use_osm else None

    # ------------------------------------------------------------ tile output
    tiles = defaultdict(list)
    for b in buildings:
        tiles[(b['tx'], b['tz'])].append(b)
    tree_tiles = defaultdict(list)
    for t in trees:
        tree_tiles[(int(math.floor(t[0] / TILE)), int(math.floor(t[1] / TILE)))].append(t)

    street_tree = None
    if use_osm:
        sl = osm.street_lines(segs)
        street_geoms = [ln for ln, _, _ in sl]
        street_names = [nm for _, nm, _ in sl]
        street_rank = [rk for _, _, rk in sl]
        street_tree = STRtree(street_geoms) if street_geoms else None
        log(f'street names: {len(sl)} named segments, {len(set(street_names))} names')

    manifest_tiles = []
    for old in os.listdir(out_dir):
        if old.endswith('.bin') and old[:2] in ('b_', 't_', 'r_'):
            os.remove(os.path.join(out_dir, old))
    total_bytes = 0
    all_tiles = set(tiles.keys()) | set(tree_tiles.keys())
    # terrain tiles cover every tile in the frame that has any land (or buildings/trees)
    for tz in range(int(minZ // TILE), int(maxZ // TILE)):
        for tx in range(int(minX // TILE), int(maxX // TILE)):
            x0, z0 = tx * TILE, tz * TILE
            sx = x0 + np.arange(TERRAIN_N) * TERRAIN_CELL
            sz = z0 + np.arange(TERRAIN_N) * TERRAIN_CELL
            SX, SZ = np.meshgrid(sx, sz)
            cl, _ = ground_at(SX.ravel(), SZ.ravel())
            if (tx, tz) not in all_tiles and np.all(cl == GROUND_WATER):
                continue
            all_tiles.add((tx, tz))
    for (tx, tz) in sorted(all_tiles, key=lambda t: (t[1], t[0])):
        x0, z0 = tx * TILE, tz * TILE
        bl = tiles.get((tx, tz), [])
        # --- buildings
        if bl:
            # one record per part; a building's parts are consecutive, tier 0 first
            recs = [(b, q) for b in bl for q in b['parts']]
            rings = []
            for b, q in recs:
                c = np.asarray(q['poly'].exterior.coords)[:-1]
                rings.append(np.round((c - [x0, z0]) * 10).astype(np.int16))
            vstart = np.zeros(len(recs) + 1, dtype=np.uint32)
            for i, r in enumerate(rings):
                vstart[i + 1] = vstart[i] + len(r)
            vx = np.concatenate([r[:, 0] for r in rings]).astype(np.int16)
            vz = np.concatenate([r[:, 1] for r in rings]).astype(np.int16)
            hdr = struct.pack('<4sIIffI', b'SBB3' if use_osm else b'SBB2', len(recs), int(vstart[-1]), x0, z0, 0)
            body = b''.join([
                np.array([b['index'] for b, _ in recs], dtype=np.uint32).tobytes(),
                np.array([b['stable'] for b, _ in recs], dtype=np.uint32).tobytes(),
                vstart.tobytes(),
                np.array([q['baseY'] for _, q in recs], dtype=np.float32).tobytes(),
                np.array([q['roofY'] for _, q in recs], dtype=np.float32).tobytes(),
                np.array([b['baseY'] for b, _ in recs], dtype=np.float32).tobytes(),  # groundY: the building's true ground
            ])
            if use_osm:
                # SBB3: colours (0xFFRRGGBB, 0 = not mapped), roof rise (dm), then the u8 rows below + roof shape,
                # roof direction, facade / roof material and the data source (see src/world/tiles.ts)
                body += b''.join([
                    np.array([q.get('facadeColor', 0) for _, q in recs], dtype=np.uint32).tobytes(),
                    np.array([q.get('roofColor', 0) for _, q in recs], dtype=np.uint32).tobytes(),
                    np.array([min(65535, int(round(q.get('roofH', 0.0) * 10))) for _, q in recs], dtype=np.uint16).tobytes(),
                ])
            u8 = b''.join([
                np.array([b['arch'] for b, _ in recs], dtype=np.uint8).tobytes(),
                np.array([b['floors'] for b, _ in recs], dtype=np.uint8).tobytes(),
                np.array([q['front'] for _, q in recs], dtype=np.uint8).tobytes(),
                np.array([q['front2'] for _, q in recs], dtype=np.uint8).tobytes(),
                np.array([b['hood'] for b, _ in recs], dtype=np.uint8).tobytes(),
                np.array([b['seed'] for b, _ in recs], dtype=np.uint8).tobytes(),
                np.array([q['tier'] for _, q in recs], dtype=np.uint8).tobytes(),
                np.array([q['taper'] for _, q in recs], dtype=np.uint8).tobytes(),
            ])
            if use_osm:
                u8 += b''.join([
                    np.array([q.get('roofShape', 0) for _, q in recs], dtype=np.uint8).tobytes(),
                    np.array([q.get('roofDir', 0) for _, q in recs], dtype=np.uint8).tobytes(),
                    np.array([q.get('facadeMat', 0) for _, q in recs], dtype=np.uint8).tobytes(),
                    np.array([q.get('roofMat', 0) for _, q in recs], dtype=np.uint8).tobytes(),
                    np.array([source_byte(b, q) for b, q in recs], dtype=np.uint8).tobytes(),
                ])
            pad = (-(len(hdr) + len(body) + len(u8))) % 4
            data = hdr + body + u8 + b'\0' * pad + vx.tobytes() + vz.tobytes()
            with open(os.path.join(out_dir, f'b_{tx}_{tz}.bin'), 'wb') as f:
                f.write(data)
            total_bytes += len(data)
        # --- terrain
        sx = x0 + np.arange(TERRAIN_N) * TERRAIN_CELL
        sz = z0 + np.arange(TERRAIN_N) * TERRAIN_CELL
        SX, SZ = np.meshgrid(sx, sz)
        hgt = dem_at(SX.ravel(), SZ.ravel())
        cl, _ = ground_at(SX.ravel(), SZ.ravel())
        hq = np.clip(np.round(hgt * 10), -32000, 32000).astype(np.int16)
        # obstacles: max(roof, ground) per 8 m cell
        obst = np.zeros((OBST_N, OBST_N), dtype=np.float32)
        oc = TILE / OBST_N
        ox = x0 + (np.arange(OBST_N) + 0.5) * oc
        oz = z0 + (np.arange(OBST_N) + 0.5) * oc
        OX, OZ = np.meshgrid(ox, oz)
        # ground max over each cell (sample 3x3)
        gmax = np.full(OX.shape, -1e9, dtype=np.float32)
        for dx in (-0.4, 0, 0.4):
            for dz in (-0.4, 0, 0.4):
                gmax = np.maximum(gmax, dem_at((OX + dx * oc).ravel(), (OZ + dz * oc).ravel()).reshape(OX.shape))
        obst = gmax
        tl = trees_here = tree_tiles.get((tx, tz), [])
        hdr = struct.pack('<4siiHHfff', b'SBT2' if use_osm else b'SBT1', tx, tz, TERRAIN_N, OBST_N, TERRAIN_CELL, x0, z0)
        tbytes = hq.tobytes() + cl.astype(np.uint8).tobytes()
        tbytes += b'\0' * ((-(len(hdr) + len(tbytes))) % 4)
        obst_off = len(hdr) + len(tbytes)
        # rasterize buildings in this and neighboring tiles into obstacle cells
        neigh = []
        for ddx in (-1, 0, 1):
            for ddz in (-1, 0, 1):
                neigh += tiles.get((tx + ddx, tz + ddz), [])
        if neigh:
            otr = rasterio.Affine(oc, 0, x0, 0, oc, z0)
            # every part at its own height: the bus clears a podium and steers around the tower on it.
            # Tall parts grow by half a cell diagonal: an 8 m cell that only grazes a 300 m wall must hold it
            # (a pitched roof or a dome is an obstacle most of the way up)
            order = sorted([(q, q['roofY'] + 0.8 * q.get('roofH', 0.0) - b['baseY']) for b in neigh for q in b['parts']], key=lambda t: t[0]['roofY'] + 0.8 * t[0].get('roofH', 0.0))
            roof = rasterize([(q['poly'].buffer(6.0 if hq > 40.0 else 3.0), float(q['roofY'] + 0.8 * q.get('roofH', 0.0))) for q, hq in order], out_shape=(OBST_N, OBST_N),
                             transform=otr, fill=-1e9, dtype=np.float32, merge_alg=rasterio.enums.MergeAlg.replace)
            obst = np.maximum(obst, roof)
        oq = np.clip(np.round(obst * 10), -32000, 32000).astype(np.int16)
        tbytes2 = oq.tobytes()
        tb = struct.pack('<HH', len(tl), 0)
        tr = b''
        for (x, z, s, k) in tl:
            y = float(dem_at([x], [z])[0])
            tr += struct.pack('<hhhBB', int(round((x - x0) * 10)), int(round((z - z0) * 10)), int(round(y * 10)), int(min(255, s * 100)), k)
        # 2 m ground-class texture (texel centers)
        cx = x0 + (np.arange(CLASS_N) + 0.5) * (TILE / CLASS_N)
        cz = z0 + (np.arange(CLASS_N) + 0.5) * (TILE / CLASS_N)
        CX, CZ = np.meshgrid(cx, cz)
        ccl, _ = ground_at(CX.ravel(), CZ.ravel())
        tr += b'\0' * ((-(len(hdr) + len(tbytes) + len(tbytes2) + len(tb) + len(tr))) % 4)
        data = hdr + tbytes + tbytes2 + tb + tr + ccl.astype(np.uint8).tobytes()
        if use_osm:
            # SBT2: the street-name section (osm.names_section)
            data += b'\0' * ((-len(data)) % 4)
            data += O.names_section(tx, tz, x0, z0, TILE, street_tree, street_geoms, street_names, street_rank, hood_index)
        with open(os.path.join(out_dir, f't_{tx}_{tz}.bin'), 'wb') as f:
            f.write(data)
        total_bytes += len(data)
        manifest_tiles.append([tx, tz, len(bl)])

    # ------------------------------------------------------------------- far
    log('far LOD')
    # mid-rises and up (LiDAR heights put ~3.4k buildings over 16 m, twice the old count: the box
    # count, which the far skyline draws every frame, stays under the old 2.3k)
    tall = [b for b in buildings if b['h'] >= FAR_MIN_HEIGHT]
    fw = int((maxX - minX) / FAR_CELL) + 1
    fh = int((maxZ - minZ) / FAR_CELL) + 1
    fxs = minX + np.arange(fw) * FAR_CELL
    fzs = minZ + np.arange(fh) * FAR_CELL
    FX, FZ = np.meshgrid(fxs, fzs)
    fhgt = dem_at(FX.ravel(), FZ.ravel())
    fcl, _ = ground_at(FX.ravel(), FZ.ravel())
    fbs = []
    for b in tall:
        parts = b['parts']
        a0 = parts[0]['poly'].area
        if b['h'] >= FAR_TIER_HEIGHT and len(parts) > 1:
            # a tower keeps its big setbacks in the distance (not its crown boxes and penthouses)
            major = [q for q in parts if q['tier'] == 0 or q['poly'].area >= 0.15 * a0]
            major = sorted(major, key=lambda q: -q['poly'].area * (q['roofY'] - q['baseY']))[:FAR_MAX_BOXES]
        else:
            # one box: the footprint up to the top of its main mass (a part covering half of it)
            main_top = max([q['roofY'] + 0.5 * q.get('roofH', 0.0) for q in parts if q['poly'].area >= 0.5 * a0] or [parts[0]['roofY']])
            major = [dict(parts[0], roofY=main_top, taper=0)]
        for q in major:
            mrr = q['poly'].minimum_rotated_rectangle
            cc = np.asarray(mrr.exterior.coords)[:4]
            e0 = cc[1] - cc[0]
            e1 = cc[2] - cc[1]
            cx, cz = cc.mean(axis=0)
            yaw = math.atan2(e0[1], e0[0])
            k = 1.0 - 0.5 * q['taper'] / 255.0  # a taper: its mean width
            fbs.append((cx, cz, k * np.hypot(*e0) / 2, k * np.hypot(*e1) / 2, yaw, q['baseY'], q['roofY'], b['index']))
    hdr = struct.pack('<4sIIIfff', b'SBF1', len(fbs), fw, fh, minX, minZ, FAR_CELL)
    body = np.array([f[:7] for f in fbs], dtype=np.float32).tobytes() + np.array([f[7] for f in fbs], dtype=np.uint32).tobytes()
    body += np.clip(np.round(fhgt * 10), -32000, 32000).astype(np.int16).tobytes() + fcl.astype(np.uint8).tobytes()
    with open(os.path.join(out_dir, 'far.bin'), 'wb') as f:
        f.write(hdr + body)
    total_bytes += len(hdr) + len(body)

    # -------------------------------------------------------------- manifest
    sx, sz = ll2xz(cfg['start']['lon'], cfg['start']['lat'])
    lms = []
    for lm in cfg.get('landmarks', []):
        x, z = ll2xz(lm['lon'], lm['lat'])
        rec = {'kind': lm['kind'], 'x': x, 'z': z, 'y': float(dem_at([x], [z])[0]), 'height': lm['height']}
        if 'points' in lm:
            rec['points'] = [list(ll2xz(lo, la)) for la, lo in lm['points']]
        lms.append(rec)
    manifest = {
        'name': cfg['name'], 'slug': slug, 'origin': cfg['origin'], 'proj': proj,
        'tileSize': TILE, 'terrainN': TERRAIN_N, 'obstN': OBST_N, 'classN': CLASS_N,
        'bounds': [minX, minZ, maxX, maxZ],
        'buildingCount': len(buildings),
        'tiles': manifest_tiles,
        'neighborhoods': [{'name': n, 'x': float(x), 'z': float(z)} for n, (x, z) in zip(hood_names, hood_label)],
        'landmarks': lms,
        'start': {'x': sx, 'z': sz, 'heading': math.radians(cfg['start']['heading_deg']), 'speed': cfg['start'].get('speed', 30), 'opening': cfg['start'].get('opening', '')},
        'source': 'FEMA/ORNL USA Structures (public domain) + USGS 3DEP 1 m DEM (public domain); rows split into ~25 ft lots'
                  + ('; rooftops (heights, tiers) from the USGS 3DEP lidar point cloud (public domain)' if lidar_rasters is not None else ''),
    }
    if use_osm:
        dem_src = 'USGS 3DEP DEM (public domain)' if cfg['dem'] or cfg.get('dem_fallback') else 'flat ground (no DEM)'
        manifest['source'] = ('OpenStreetMap via Overture Maps (' + osm.release + '; ODbL 1.0): footprints, building parts, roofs, '
                              'streets, land, water, trees, names'
                              + ('; FEMA/ORNL USA Structures (public domain) where OSM has no footprint' if df is not None else '')
                              + '; ' + dem_src
                              + ('; rooftops (heights, tiers) from the USGS 3DEP lidar point cloud (public domain)' if lidar_rasters is not None else ''))
        manifest['attribution'] = '\u00a9 OpenStreetMap contributors, Overture Maps Foundation'
        manifest['license'] = 'ODbL-1.0'
        hs = defaultdict(int)
        for b in buildings:
            hs[b.get('hsrc') or 'default'] += 1
        counts['heights'] = dict(hs)
        counts['buildings'] = {k: sum(1 for b in buildings if b.get('src') == k) for k in ('osm', 'ovt', 'usa', 'lidar')}
        counts['osmParts'] = sum(1 for b in buildings if b.get('osmParts'))
        counts['lidarTiers'] = sum(1 for b in buildings if b.get('tiered') and not b.get('osmParts'))
        manifest['stats'] = counts
        log('stats: ' + json.dumps(counts))
    with open(os.path.join(out_dir, 'city.json'), 'w') as f:
        json.dump(manifest, f)
    log(f'done: {len(buildings)} buildings, {len(manifest_tiles)} tiles, {total_bytes/1e6:.1f} MB raw')


if __name__ == '__main__':
    main()
