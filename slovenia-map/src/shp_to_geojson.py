#!/usr/bin/env python3
"""
shp_to_geojson.py

Convert an ESRI Shapefile (.shp) into a GeoJSON (.geojson) file.

Requires the lightweight, pure-Python 'pyshp' library (no GDAL needed):
    pip install pyshp

Usage:
    python shp_to_geojson.py input.shp output.geojson
    python shp_to_geojson.py input.shp                 # writes input.geojson
    python shp_to_geojson.py input.shp --pretty         # pretty-printed output
    python shp_to_geojson.py input.shp --crs EPSG:4326  # attach a CRS note (see caveat below)

Note on coordinates:
    GeoJSON is specified to use WGS84 (EPSG:4326) longitude/latitude
    coordinates. This script does NOT reproject data — it just repackages
    whatever coordinates are already in the shapefile. If your shapefile
    uses a different projection (check the companion .prj file), reproject
    it first (e.g. with GDAL's ogr2ogr) for a spec-correct GeoJSON.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import warnings
import zipfile
from datetime import date, datetime

# pyshp warns when the encoding we pass differs from the (often non-standard)
# name it read out of the .cpg file, e.g. "ansi 1250" instead of "cp1250".
# The warning is harmless here since we explicitly choose a working encoding.
warnings.filterwarnings("ignore", category=UserWarning, module="shapefile")

try:
    import shapefile  # from the 'pyshp' package
except ImportError:
    sys.exit(
        "Error: the 'pyshp' package is required.\n"
        "Install it with:  pip install pyshp"
    )


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles date and datetime objects."""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        elif isinstance(obj, date):
            return obj.isoformat()
        return super().default(obj)


# Map common DBF encoding aliases to Python codec names
ENCODING_ALIASES = {
    "ansi 1250": "cp1250",  # Windows-1250 (Central/Eastern European)
    "ansi 1251": "cp1251",  # Windows-1251 (Cyrillic)
    "ansi 1252": "cp1252",  # Windows-1252 (Western European)
    "cp1250": "cp1250",
    "cp1251": "cp1251",
    "cp1252": "cp1252",
    "iso-8859-2": "iso8859-2",  # Central European
    "iso-8859-5": "iso8859-5",  # Cyrillic
}


def normalize_encoding(encoding_name: str) -> str:
    """Normalize encoding names, mapping common DBF variants to Python codecs."""
    if not encoding_name:
        return "utf-8"
    normalized = encoding_name.lower().strip()
    return ENCODING_ALIASES.get(normalized, normalized)


def _remove_temp_dir(tmp_dir: str) -> None:
    """Remove a temp directory, with retries for Windows permission errors."""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            shutil.rmtree(tmp_dir, ignore_errors=False)
            return
        except PermissionError:
            if attempt < max_retries - 1:
                # Wait a bit and retry
                time.sleep(0.5)
            else:
                # Last attempt: ignore errors and proceed
                shutil.rmtree(tmp_dir, ignore_errors=True)


def _extract_shp_from_zip(zip_path: str, tmp_dir: str, layer: str | None = None) -> str:
    """Extract a .zip archive and return the path to the .shp file inside it."""
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmp_dir)

    shp_files = []
    for root, _dirs, files in os.walk(tmp_dir):
        for name in files:
            if name.lower().endswith(".shp"):
                shp_files.append(os.path.join(root, name))

    if not shp_files:
        sys.exit(f"Error: no .shp file found inside {zip_path}")

    if layer:
        for path in shp_files:
            if os.path.splitext(os.path.basename(path))[0].lower() == layer.lower():
                return path
        sys.exit(
            f"Error: layer '{layer}' not found in {zip_path}. "
            f"Available: {[os.path.splitext(os.path.basename(p))[0] for p in shp_files]}"
        )

    if len(shp_files) > 1:
        names = [os.path.splitext(os.path.basename(p))[0] for p in shp_files]
        print(
            f"Note: zip contains multiple shapefiles {names}; "
            f"using '{names[0]}'. Pass --layer to pick a different one.",
            file=sys.stderr,
        )

    return shp_files[0]


def convert(shp_path: str, geojson_path: str, pretty: bool = False, crs: str | None = None,
            layer: str | None = None) -> None:
    if not os.path.exists(shp_path):
        sys.exit(f"Error: input file not found: {shp_path}")

    if shp_path.lower().endswith(".zip"):
        tmp_dir = tempfile.mkdtemp()
        try:
            extracted_shp = _extract_shp_from_zip(shp_path, tmp_dir, layer=layer)
            reader = _load_shapefile_with_encoding_fallback(extracted_shp)
            # Read all data into memory while files are still open
            features = _read_features(reader)
            # Now close and release file handles
            try:
                reader.close()
            except AttributeError:
                pass
            del reader
            # Write the accumulated features
            _write_geojson_from_features(features, geojson_path, pretty=pretty, crs=crs)
        finally:
            # Clean up temp directory with retry on Windows permission errors
            _remove_temp_dir(tmp_dir)

    reader = _load_shapefile_with_encoding_fallback(shp_path)
    features = _read_features(reader)
    _write_geojson_from_features(features, geojson_path, pretty=pretty, crs=crs)


def _load_shapefile_with_encoding_fallback(shp_path: str) -> "shapefile.Reader":
    """Load a shapefile, trying multiple encodings if the first one fails."""
    # Try encodings in order of likelihood
    encodings_to_try = [
        None,  # Let pyshp auto-detect
        "utf-8",
        "cp1250",  # Central European (Windows-1250)
        "cp1252",  # Western European (Windows-1252)
        "iso8859-2",  # Central European (ISO)
        "latin2",  # Alias for ISO-8859-2
    ]
    
    # Try each encoding with strict error handling first
    last_error = None
    for encoding in encodings_to_try:
        try:
            if encoding:
                reader = shapefile.Reader(shp_path, encoding=encoding, encoding_errors="strict")
            else:
                reader = shapefile.Reader(shp_path)
            # Attempt to read at least one record to verify encoding works
            _ = list(reader.iterShapeRecords())
            return reader
        except (LookupError, UnicodeDecodeError, Exception) as e:
            last_error = e
            continue
    
    # If strict mode failed for all encodings, try with 'replace' error handling
    # This will replace invalid characters with ? instead of crashing
    for encoding in encodings_to_try:
        try:
            if encoding:
                reader = shapefile.Reader(shp_path, encoding=encoding, encoding_errors="replace")
            else:
                reader = shapefile.Reader(shp_path, encoding_errors="replace")
            # Attempt to read at least one record
            _ = list(reader.iterShapeRecords())
            print(
                f"Warning: Using encoding '{encoding or 'auto-detect'}' with error replacement. "
                f"Some characters may be replaced with '?'.",
                file=sys.stderr,
            )
            return reader
        except Exception as e:
            last_error = e
            continue
    
    # If all encodings failed, raise the last error
    sys.exit(
        f"Error: Could not read shapefile with any encoding.\n"
        f"Last error: {last_error}\n"
        f"Your shapefile may use an unsupported or corrupted encoding."
    )


def _read_features(reader: "shapefile.Reader") -> list:
    """Read all features from a shapefile into memory (while file handles are open)."""
    fields = reader.fields[1:]  # skip the DeletionFlag field
    field_names = [f[0] for f in fields]

    features = []
    for sr in reader.shapeRecords():
        shape = sr.shape
        geom = shape.__geo_interface__
        
        # Preserve Z and M coordinates if present (for 3D/4D shapefiles).
        # Not all pyshp shape objects expose a `hasZ` attribute, so check
        # for a non-empty `z` list instead.
        z_values = getattr(shape, 'z', None)
        if z_values:
            m_values = getattr(shape, 'm', None)
            geom = _add_z_to_geometry(geom, z_values, m_values)
        
        atts = dict(zip(field_names, sr.record))

        # Make sure attribute values are JSON-serializable
        clean_atts = {}
        for k, v in atts.items():
            if isinstance(v, (bytes,)):
                v = v.decode("utf-8", errors="replace")
            clean_atts[k] = v

        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": clean_atts,
            }
        )
    
    return features


def _add_z_to_geometry(geom: dict, z_values: list, m_values: list | None = None) -> dict:
    """Add Z (and optionally M) coordinates to a 2D geometry from a shapefile."""
    if geom is None or geom.get("type") is None:
        return geom
    
    geom_type = geom.get("type")
    coords = geom.get("coordinates", [])
    
    if geom_type == "Point":
        # Point: [x, y] -> [x, y, z] or [x, y, z, m]
        if coords and z_values:
            coords = list(coords) + [z_values[0]]
            if m_values:
                coords.append(m_values[0])
    
    elif geom_type == "LineString":
        # LineString: [[x, y], ...] -> [[x, y, z], ...]
        coords = _add_z_to_point_array(coords, z_values, m_values)
    
    elif geom_type == "Polygon":
        # Polygon: [[[x, y], ...], ...] -> [[[x, y, z], ...], ...]
        coords = [_add_z_to_point_array(ring, z_values, m_values) for ring in coords]
    
    elif geom_type == "MultiPoint":
        # MultiPoint: [[x, y], ...] -> [[x, y, z], ...]
        coords = _add_z_to_point_array(coords, z_values, m_values)
    
    elif geom_type == "MultiLineString":
        # MultiLineString: [[[x, y], ...], ...] -> [[[x, y, z], ...], ...]
        coords = [_add_z_to_point_array(line, z_values, m_values) for line in coords]
    
    elif geom_type == "MultiPolygon":
        # MultiPolygon: [[[[x, y], ...], ...], ...] -> [[[[x, y, z], ...], ...], ...]
        coords = [
            [_add_z_to_point_array(ring, z_values, m_values) for ring in poly]
            for poly in coords
        ]
    
    return {**geom, "coordinates": coords}


def _add_z_to_point_array(points: list, z_values: list, m_values: list | None = None) -> list:
    """Add Z and optionally M values to an array of 2D points."""
    if not points or not z_values:
        return points
    
    result = []
    for i, point in enumerate(points):
        if i < len(z_values):
            pt = list(point) + [z_values[i]]
            if m_values and i < len(m_values):
                pt.append(m_values[i])
            result.append(pt)
        else:
            result.append(point)
    
    return result


def _write_geojson_from_features(features: list, geojson_path: str, pretty: bool = False,
                                   crs: str | None = None) -> None:
    """Write in-memory features to a GeoJSON file."""
    feature_collection = {
        "type": "FeatureCollection",
        "features": features,
    }

    if crs:
        # Legacy-style CRS member. Not part of modern GeoJSON (RFC 7946,
        # which assumes WGS84), but some older tools still read it.
        feature_collection["crs"] = {
            "type": "name",
            "properties": {"name": crs},
        }

    with open(geojson_path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(feature_collection, f, indent=2, cls=DateTimeEncoder)
        else:
            json.dump(feature_collection, f, cls=DateTimeEncoder)

    print(f"Wrote {len(features)} feature(s) to {geojson_path}")


def main():
    parser = argparse.ArgumentParser(description="Convert a Shapefile (or zipped Shapefile) to GeoJSON.")
    parser.add_argument("input", help="Path to the input .shp or .zip file")
    parser.add_argument(
        "output",
        nargs="?",
        default=None,
        help="Path to the output .geojson file (defaults to <input>.geojson)",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print the output JSON"
    )
    parser.add_argument(
        "--crs",
        default=None,
        help="Optional CRS name to attach as a legacy 'crs' member, e.g. EPSG:4326",
    )
    parser.add_argument(
        "--layer",
        default=None,
        help="If the .zip contains multiple shapefiles, the name (no extension) of the one to convert",
    )
    args = parser.parse_args()

    output = args.output or os.path.splitext(args.input)[0] + ".geojson"
    convert(args.input, output, pretty=args.pretty, crs=args.crs, layer=args.layer)


if __name__ == "__main__":
    main()