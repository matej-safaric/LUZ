#!/usr/bin/env python3
"""
drape_geojson_on_pointcloud.py  (v2 -- pure Python, no PDAL/GDAL binaries)

Drape a 2D GeoJSON (points/lines/polygons) onto a LAZ point cloud that is
"2.5D" -- i.e. no two points share the same (x, y), so the cloud defines a
single-valued height function z = f(x, y).

Why v2: the original version shelled out to the `pdal` command-line tool,
which is a real pain to get installed and on PATH on Windows. This version
reads the LAZ directly with laspy and interpolates heights with a KD-tree
+ inverse-distance-weighting, so the only dependencies are pip-installable
pure/wheel packages -- nothing that needs a system install.

Pipeline
--------
1. Read the LAZ file with laspy; get its CRS from the file's own VLR
   (GeoTIFF keys or WKT) unless you override it with --horiz-crs.
2. Build a 2D KD-tree over the cloud's (x, y) coordinates.
3. Read the GeoJSON. If it has an explicit top-level "crs" member (common
   in ArcGIS/QGIS exports, even though RFC 7946 says GeoJSON should always
   be WGS84), treat its coordinates as already being in that CRS. Otherwise
   assume WGS84 lon/lat per spec.
4. Reproject the GeoJSON geometries into the point cloud's CRS (a no-op if
   they're already in it, as with the sample data this script was written
   against).
5. Clip every geometry to the point cloud's bounding box (+ small buffer),
   since a point cloud tile usually covers far less area than the vector
   dataset it's being draped onto. Features entirely outside are dropped.
6. Densify (segmentize) what's left so long straight segments pick up
   intermediate vertices -- otherwise a straight edge cuts through hills
   instead of following the surface.
6b. For Polygon/MultiPolygon geometry: add a grid of interior points, run
   a Delaunay triangulation over (densified boundary + interior grid), and
   keep only the triangles that fall inside the polygon (correctly
   excluding holes). Each surviving triangle is emitted as its own 3-vertex
   GeoJSON polygon. A 3-vertex polygon has no "interior" for Cesium to
   flat-shade -- the triangle IS the fill -- so the mesh follows terrain
   relief instead of bridging across it in a flat plane. Disable with
   --no-mesh-polygons to fall back to boundary-only draping (fewer output
   features, but interior fill will flat-shade in Cesium).
7. For every vertex, query the KD-tree for its k nearest cloud points and
   IDW-average their heights.
8. Reproject back to WGS84 lon/lat, convert the sampled height to
   ellipsoidal height via a compound CRS (horizontal + geoid model), and
   add a small constant vertical offset to avoid z-fighting with the
   rendered point cloud.
9. Write a GeoJSON with XYZ coordinates, ready for
   Cesium.GeoJsonDataSource with clampToGround: false.

Install (Windows / macOS / Linux, all pip, no system packages needed)
-----------------------------------------------------------------------
    pip install laspy[lazrs] shapely pyproj numpy scipy

    (laspy needs a LAZ backend to decompress compressed LAZ files -- the
    [lazrs] extra pulls in a pure-Rust one that ships as a wheel, so no
    compiler or system LASzip install is required. If that extra ever
    fails to build, `pip install laszip` and laspy will use that backend
    instead.)

Usage (matches the sample files this was tested against)
-----------------------------------------------------------------------
    python drape_geojson_on_pointcloud.py ^
        --laz GKOT_461_101.laz ^
        --geojson CkatMOL2025.geojson ^
        --out draped.geojson

CRS is auto-detected from both files in that case. Override if needed:

    python drape_geojson_on_pointcloud.py --laz ... --geojson ... --out ... ^
        --horiz-crs EPSG:3794 --compound-crs "EPSG:3794+EPSG:8690"

EPSG:8690 = SVS2010, the current Slovenian height datum (replaced SVS2000
/ EPSG:5779 in 2019). If your data predates 2019 survey adjustments, use
EPSG:5779 instead. If pyproj can't find the geoid grid, it will try to
auto-download it the first time (needs an internet connection once); if
that's not available, omit --compound-crs and heights are treated as
already ellipsoidal (fine for visualization, off by ~40-45 m otherwise --
enough to be obviously wrong, not enough to be subtle).
"""

import argparse
import json
import sys

import numpy as np


def log(msg):
    print(f"[drape] {msg}", file=sys.stderr)


# --------------------------------------------------------------------------
# Point cloud loading
# --------------------------------------------------------------------------

def load_point_cloud(laz_path, classification=None):
    import laspy

    log(f"reading {laz_path} ...")
    las = laspy.read(laz_path)
    n = len(las.points)
    log(f"{n:,} points read")

    if classification:
        mask = np.isin(las.classification, classification)
        kept = int(mask.sum())
        log(f"filtering to classification {classification}: {kept:,} / {n:,} points kept")
        if kept == 0:
            raise RuntimeError(
                f"no points with classification in {classification}; "
                f"check what classes exist with --list-classifications"
            )
        xs = np.asarray(las.x[mask], dtype=np.float64)
        ys = np.asarray(las.y[mask], dtype=np.float64)
        zs = np.asarray(las.z[mask], dtype=np.float64)
    else:
        xs = np.asarray(las.x, dtype=np.float64)
        ys = np.asarray(las.y, dtype=np.float64)
        zs = np.asarray(las.z, dtype=np.float64)

    crs = None
    try:
        crs = las.header.parse_crs()
    except Exception as exc:
        log(f"warning: could not auto-parse CRS from LAZ header: {exc}")

    bounds = (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))
    return xs, ys, zs, crs, bounds


def list_classifications(laz_path):
    import laspy
    from collections import Counter

    las = laspy.read(laz_path)
    counts = Counter(np.asarray(las.classification))
    for code, count in sorted(counts.items()):
        print(f"  class {code}: {count:,} points")


# --------------------------------------------------------------------------
# KD-tree height sampler (replaces the old DEM-raster step)
# --------------------------------------------------------------------------

class KDTreeSampler:
    def __init__(self, xs, ys, zs, k=8, power=2.0, max_radius=None):
        from scipy.spatial import cKDTree

        self.tree = cKDTree(np.column_stack([xs, ys]))
        self.zs = zs
        self.k = k
        self.power = power
        self.max_radius = max_radius

    def sample(self, xq, yq):
        """xq, yq: 1D arrays. Returns array of heights (NaN where out of range)."""
        pts = np.column_stack([xq, yq])
        dist, idx = self.tree.query(pts, k=self.k)
        if self.k == 1:
            dist = dist[:, None]
            idx = idx[:, None]

        z_neighbors = self.zs[idx]  # (n, k)

        # exact / near-exact matches: avoid div-by-zero, just take that point's z
        exact = dist[:, 0] < 1e-9
        with np.errstate(divide="ignore"):
            weights = 1.0 / np.power(dist, self.power)
        weights[~np.isfinite(weights)] = 0.0
        wsum = weights.sum(axis=1)
        wsum[wsum == 0] = np.nan
        heights = (weights * z_neighbors).sum(axis=1) / wsum
        heights[exact] = z_neighbors[exact, 0]

        if self.max_radius is not None:
            heights[dist[:, 0] > self.max_radius] = np.nan

        return heights


# --------------------------------------------------------------------------
# GeoJSON CRS handling
# --------------------------------------------------------------------------

def detect_geojson_crs(gj):
    """
    Returns a CRS string pyproj understands, or None if the file is (per
    RFC 7946 default) WGS84 lon/lat with no override.
    """
    crs_member = gj.get("crs")
    if not crs_member:
        return None
    try:
        name = crs_member["properties"]["name"]
    except (KeyError, TypeError):
        return None
    # typical forms: "urn:ogc:def:crs:EPSG::3794" or "EPSG:3794"
    if "EPSG" in name.upper():
        digits = "".join(ch for ch in name.split(":")[-1] if ch.isdigit())
        if digits:
            return f"EPSG:{digits}"
    return name


# --------------------------------------------------------------------------
# Shared: drape an array of (x, y) points -> (lon, lat, ell) arrays
# --------------------------------------------------------------------------

def drape_xy(xs, ys, sampler, to_wgs84_fn, z_offset, fallback):
    """
    xs, ys: 1D arrays in the point cloud's horizontal CRS.
    Returns (lons, lats, ells, any_nan) -- ells already include z_offset.
    pyproj's Transformer.transform accepts array input directly, so this
    stays fully vectorized (no per-point Python loop).
    """
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    heights = sampler.sample(xs, ys)
    any_nan = bool(np.isnan(heights).any())
    if any_nan and fallback == "zero":
        heights = np.nan_to_num(heights, nan=0.0)

    lons, lats, ells = to_wgs84_fn(xs, ys, heights)
    lons = np.atleast_1d(np.asarray(lons, dtype=np.float64))
    lats = np.atleast_1d(np.asarray(lats, dtype=np.float64))
    ells = np.atleast_1d(np.asarray(ells, dtype=np.float64)) + z_offset
    return lons, lats, ells, any_nan


# --------------------------------------------------------------------------
# Polygon interior meshing (constrained-ish Delaunay via dense boundary +
# interior grid, filtered to stay inside the polygon and out of holes)
# --------------------------------------------------------------------------

def mesh_polygon(poly, interior_spacing, max_interior_points=20000):
    """
    poly: a shapely Polygon, already densified along its boundary.
    Returns a list of triangles, each a 3-tuple of (x, y) vertex coords, in
    the same CRS as `poly`. Interior grid points are added and an
    unconstrained Delaunay triangulation is run over (boundary + interior)
    points; triangles whose centroid falls outside the polygon (including
    inside a hole) are dropped. Because the boundary is densely sampled
    relative to the interior grid, this tracks the true boundary closely
    without needing a constrained-triangulation library.
    """
    from shapely.geometry import Point
    from shapely.prepared import prep
    from scipy.spatial import Delaunay, QhullError

    boundary_pts = list(poly.exterior.coords)
    for ring in poly.interiors:
        boundary_pts += list(ring.coords)

    prepared = prep(poly)
    minx, miny, maxx, maxy = poly.bounds
    if interior_spacing <= 0:
        interior_pts = []
    else:
        xs = np.arange(minx + interior_spacing / 2, maxx, interior_spacing)
        ys = np.arange(miny + interior_spacing / 2, maxy, interior_spacing)
        interior_pts = [
            (x, y) for x in xs for y in ys if prepared.contains(Point(x, y))
        ]
        if len(interior_pts) > max_interior_points:
            log(f"  polygon interior grid has {len(interior_pts)} points, "
                f"capping to {max_interior_points} (increase --interior-spacing "
                f"to reduce this, or raise --max-interior-points)")
            idx = np.random.default_rng(0).choice(
                len(interior_pts), max_interior_points, replace=False)
            interior_pts = [interior_pts[i] for i in idx]

    all_pts = np.array(boundary_pts + interior_pts, dtype=np.float64)
    if len(all_pts) < 3:
        return []

    try:
        tri = Delaunay(all_pts)
    except QhullError:
        return []

    # small buffer so a centroid that lands exactly on a boundary edge
    # (floating point) still counts as inside, avoiding stray gaps
    inside_check = prep(poly.buffer(1e-6))

    triangles = []
    for simplex in tri.simplices:
        p0, p1, p2 = all_pts[simplex]
        cx = (p0[0] + p1[0] + p2[0]) / 3.0
        cy = (p0[1] + p1[1] + p2[1]) / 3.0
        if inside_check.contains(Point(cx, cy)):
            triangles.append((tuple(p0), tuple(p1), tuple(p2)))
    return triangles


# --------------------------------------------------------------------------
# Geometry pipeline: reproject -> clip -> densify -> sample -> back to WGS84
# --------------------------------------------------------------------------

def process_geojson(gj, src_crs, horiz_crs, cloud_bounds, densify_step,
                     clip_buffer, sampler, to_wgs84_fn, z_offset, fallback,
                     mesh_polygons=True, interior_spacing=2.0,
                     max_interior_points=20000):
    from pyproj import Transformer
    from shapely.geometry import shape, mapping, box
    from shapely.ops import transform as sh_transform
    import shapely

    features = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    log(f"{len(features)} input feature(s)")

    if src_crs and src_crs.replace(" ", "").upper() != horiz_crs.replace(" ", "").upper():
        to_horiz = Transformer.from_crs(src_crs, horiz_crs, always_xy=True).transform
    elif src_crs is None:
        to_horiz = Transformer.from_crs("EPSG:4326", horiz_crs, always_xy=True).transform
    else:
        to_horiz = None  # already in the target CRS, skip reprojection

    minx, miny, maxx, maxy = cloud_bounds
    clip_box = box(minx - clip_buffer, miny - clip_buffer,
                    maxx + clip_buffer, maxy + clip_buffer)

    kept, dropped_outside, dropped_nan, triangle_count = [], 0, 0, 0

    def _shapely_xyz(x, y, z=None):
        # shapely.ops.transform passes whole coordinate arrays at once.
        lons, lats, ells, any_nan = drape_xy(x, y, sampler, to_wgs84_fn,
                                              z_offset, fallback)
        if any_nan:
            had_nan[0] = True
        return lons, lats, ells

    for feat_idx, feat in enumerate(features):
        geom = shape(feat["geometry"])
        if to_horiz is not None:
            geom = sh_transform(to_horiz, geom)

        clipped = geom.intersection(clip_box)
        if clipped.is_empty:
            dropped_outside += 1
            continue

        is_polygonal = clipped.geom_type in ("Polygon", "MultiPolygon")

        if is_polygonal and mesh_polygons:
            polys = [clipped] if clipped.geom_type == "Polygon" else list(clipped.geoms)
            feat_had_nan = False
            n_tris = 0
            for poly in polys:
                densified_poly = shapely.segmentize(poly, densify_step)
                for tri in mesh_polygon(densified_poly, interior_spacing,
                                         max_interior_points):
                    xs = np.array([tri[0][0], tri[1][0], tri[2][0]])
                    ys = np.array([tri[0][1], tri[1][1], tri[2][1]])
                    lons, lats, ells, any_nan = drape_xy(
                        xs, ys, sampler, to_wgs84_fn, z_offset, fallback)
                    if any_nan:
                        feat_had_nan = True
                        if fallback == "drop":
                            continue
                    ring = list(zip(lons.tolist(), lats.tolist(), ells.tolist()))
                    ring.append(ring[0])  # close the ring
                    kept.append({
                        "type": "Feature",
                        "properties": {**feat.get("properties", {}),
                                       "_source_feature": feat_idx},
                        "geometry": {"type": "Polygon", "coordinates": [ring]},
                    })
                    n_tris += 1
            triangle_count += n_tris
            if n_tris == 0:
                dropped_outside += 1
            elif feat_had_nan and fallback == "drop":
                dropped_nan += 1  # some triangles from this feature were skipped
            continue

        # generic path: points, lines, or polygons with meshing disabled
        # (boundary-only drape -- polygon interiors will flat-shade in Cesium)
        densified = shapely.segmentize(clipped, densify_step)
        had_nan = [False]
        draped_geom = sh_transform(_shapely_xyz, densified)

        if had_nan[0] and fallback == "drop":
            dropped_nan += 1
            continue

        kept.append({**feat, "geometry": mapping(draped_geom)})

    log(f"kept {len(kept)} output feature(s) ({triangle_count} polygon "
        f"triangles), dropped {dropped_outside} (outside tile), "
        f"{dropped_nan} (unsampleable vertices)")
    return kept


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Drape a GeoJSON onto a LAZ point cloud for CesiumJS "
                     "(pure Python, no PDAL/GDAL binary required).")
    ap.add_argument("--laz", required=True)
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--horiz-crs", default=None,
                     help="override the point cloud's horizontal CRS "
                          "(default: auto-detected from the LAZ file)")
    ap.add_argument("--compound-crs", default=None,
                     help="compound CRS 'HORIZ+VERTICAL' used to convert "
                          "sampled heights to WGS84 ellipsoidal height, "
                          "e.g. 'EPSG:3794+EPSG:8690'. Omit to treat "
                          "sampled heights as already ellipsoidal.")
    ap.add_argument("--k", type=int, default=8,
                     help="neighbors used for IDW height interpolation (default 8)")
    ap.add_argument("--idw-power", type=float, default=2.0)
    ap.add_argument("--max-search-radius", type=float, default=5.0,
                     help="max distance (map units) to a cloud point before "
                          "a query location is considered unsampleable (default 5.0)")
    ap.add_argument("--densify-step", type=float, default=1.0,
                     help="max segment length before resampling, in the "
                          "point cloud's CRS units (default 1.0)")
    ap.add_argument("--clip-buffer", type=float, default=2.0,
                     help="buffer (map units) around the point cloud's "
                          "bounding box used when clipping input geometry (default 2.0)")
    ap.add_argument("--z-offset", type=float, default=0.15,
                     help="constant height added to every vertex to avoid "
                          "z-fighting with the rendered point cloud (default 0.15)")
    ap.add_argument("--fallback", choices=["drop", "zero"], default="drop")
    ap.add_argument("--classification", default=None,
                     help="comma-separated LAS classification codes to keep "
                          "(e.g. '2' for ground-only). Default: use all points.")
    ap.add_argument("--list-classifications", action="store_true",
                     help="print classification codes present in the LAZ and exit")
    ap.add_argument("--no-mesh-polygons", action="store_true",
                     help="drape polygon boundaries only (old behavior) "
                          "instead of triangulating the interior. Faster and "
                          "far fewer output features, but the fill will "
                          "flat-shade across terrain relief in Cesium.")
    ap.add_argument("--interior-spacing", type=float, default=2.0,
                     help="spacing (map units) of the interior grid points "
                          "used to triangulate polygon fills (default 2.0). "
                          "Smaller = mesh hugs terrain more tightly but many "
                          "more output triangles/features.")
    ap.add_argument("--max-interior-points", type=int, default=20000,
                     help="safety cap on interior grid points per polygon, "
                          "to keep huge polygons from producing runaway "
                          "triangle counts (default 20000)")
    args = ap.parse_args()

    if args.list_classifications:
        list_classifications(args.laz)
        return

    classification = None
    if args.classification:
        classification = [int(c) for c in args.classification.split(",")]

    xs, ys, zs, detected_crs, bounds = load_point_cloud(args.laz, classification)

    horiz_crs = args.horiz_crs
    if horiz_crs is None:
        if detected_crs is None:
            raise SystemExit(
                "Could not auto-detect the LAZ file's CRS -- pass --horiz-crs "
                "explicitly (e.g. --horiz-crs EPSG:3794)."
            )
        horiz_crs = f"EPSG:{detected_crs.to_epsg()}" if detected_crs.to_epsg() else detected_crs.to_wkt()
    log(f"point cloud horizontal CRS: {horiz_crs}")
    log(f"point cloud bounds: {bounds}")

    sampler = KDTreeSampler(xs, ys, zs, k=args.k, power=args.idw_power,
                             max_radius=args.max_search_radius)

    from pyproj import Transformer
    if args.compound_crs:
        to_wgs84 = Transformer.from_crs(args.compound_crs, "EPSG:4979", always_xy=True).transform
    else:
        log("no --compound-crs given: sampled heights are treated as "
            "already ellipsoidal")
        to_wgs84_horiz = Transformer.from_crs(horiz_crs, "EPSG:4326", always_xy=True).transform

        def to_wgs84(x, y, z):
            lon, lat = to_wgs84_horiz(x, y)
            return lon, lat, z

    with open(args.geojson, encoding="utf-8") as f:
        gj = json.load(f)

    src_crs = detect_geojson_crs(gj)
    if src_crs:
        log(f"GeoJSON declares its own CRS: {src_crs}")
    else:
        log("GeoJSON has no CRS override; assuming WGS84 lon/lat per RFC 7946")

    draped_features = process_geojson(
        gj, src_crs, horiz_crs, bounds, args.densify_step,
        args.clip_buffer, sampler, to_wgs84, args.z_offset, args.fallback,
        mesh_polygons=not args.no_mesh_polygons,
        interior_spacing=args.interior_spacing,
        max_interior_points=args.max_interior_points)

    out_gj = {"type": "FeatureCollection", "features": draped_features}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out_gj, f)
    log(f"wrote {len(draped_features)} draped feature(s) -> {args.out}")


if __name__ == "__main__":
    main()