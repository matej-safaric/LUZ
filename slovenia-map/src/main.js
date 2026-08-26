import "./style.css";

// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import WebGLTileLayer from "ol/layer/WebGLTile.js";
import {toLonLat, fromLonLat, transform} from "ol/proj.js";
import {boundingExtent} from "ol/extent.js";
import GeoTIFF from "ol/source/GeoTIFF.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import CircleStyle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";

// Cesium
import {
  Viewer, 
  Cartesian3,
  Cesium3DTileset,
  Cartographic,
  Math as CesiumMath,
  Transforms,
  Matrix4,
  Cartesian2,
  HeadingPitchRoll,
  HeadingPitchRange,
  IntersectionTests,
  Ellipsoid,
  Ray,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";



/* ========================================================
                            OL MAP
   ======================================================== */

// We define EPSG:3794 (otherwise OL gets confused)
proj4.defs(
    "EPSG:3794",
    "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 " +
    "+x_0=500000 +y_0=-5000000 " +
    "+ellps=GRS80 +units=m +no_defs"
);

register(proj4);



// Default map:

const baseLayer = new TileLayer({
  source: new OSM(),
});



// Orthophoto layer:

const  orthophotoLayer = new WebGLTileLayer({
  source: new GeoTIFF({
    sources: [
      {
        url: "/data/POF_461_101.tif"
      },
    ],
  }),
  preload: 0,
  cacheSize: 512,
});


const map2d = new Map({
  target: 'map-2d',

  layers: [
    orthophotoLayer, // lowest layer?
    // pointLayer,
  ],

  view: new View({
    center: fromLonLat([14.5058, 46.0569]),
    zoom: 15,
  }),
});


/* ========================================================
                           CESIUM MAP
   ======================================================== */




// Cesium map:
const viewer = new Viewer('map-3d', {
  animation: false,
  timeline: false,
  globe: false,
});



loadPointCloud();
// ─────────────────────────────────────────────────────────────
//  Optimized Point Cloud Loader
//  Drop-in replacement for loadPointCloud()
//
//  Changes from original:
//    • Progressive LOD — coarser at distance, finer when close
//    • Dynamic Screen Space Error tied to camera altitude
//    • Adaptive quality — backs off detail if FPS drops below 30
//    • Memory cap with automatic distant-tile eviction
//    • Point attenuation — points scale with depth for visual clarity
//    • Smooth fly-to instead of instant zoomTo
// ─────────────────────────────────────────────────────────────

let _pointCloudTileset = null; // module-level ref for LOD handlers

async function loadPointCloud() {
    // ── 1. Load tileset with progressive / LOD settings ──────
    const tileset = await Cesium3DTileset.fromUrl(
        "/pointcloud/tiles/tileset.json",
        {
            // Start coarse so the first frame appears quickly,
            // then Cesium refines tiles as the camera settles.
            maximumScreenSpaceError: 64,

            // Cap GPU memory usage; distant tiles are evicted
            // automatically when this limit is approached.
            // Tune upward (1024+) on high-RAM machines.
            maximumMemoryUsage: 512,

            // Show a coarse version immediately instead of
            // waiting for the full hierarchy to be parsed.
            skipScreenSpaceErrorUntilReady: true,
            skipLevelOfDetail: false,

            // Point cloud visual quality
            pointCloudShading: {
                attenuation: true,       // points shrink with distance
                maximumAttenuation: 3,   // max point size in pixels
                geometricErrorScale: 1.0,
            },
        }
    );

    viewer.scene.primitives.add(tileset);
    _pointCloudTileset = tileset;

    // ── 2. Smooth fly-to with a comfortable overhead angle ───
    const boundingSphere = tileset.boundingSphere;
    viewer.camera.flyToBoundingSphere(boundingSphere, {
        duration: 2.0,
        offset: new HeadingPitchRange(
            0,                          // heading: north-up
            CesiumMath.toRadians(-45), // pitch: looking down 45°
            boundingSphere.radius * 2.5 // distance from center
        ),
    });

    // ── 3. Dynamic LOD — adjust SSE as camera altitude changes ─
    //
    //  Screen Space Error (SSE) controls how aggressively Cesium
    //  simplifies geometry. Higher = coarser = faster; lower =
    //  finer = slower but more detailed.
    //
    //  For a 1km x 1km small-scale dataset with very high point
    //  density (10M+ points in limited area), altitude thresholds
    //  are compressed. Breakpoints assume camera heights from
    //  ~5km (full dataset view) down to ground level.
    viewer.scene.postRender.addEventListener(() => {
        if (!_pointCloudTileset) return;

        const height = viewer.camera.positionCartographic.height - 281.68;

        let targetSSE;
        if      (height > 3_000)  targetSSE = 64;  // far overview (full 1km visible)
        else if (height > 1_500)  targetSSE = 24;   // mid overview
        else if (height > 800)    targetSSE = 8;   // start seeing neighborhoods
        else if (height > 300)    targetSSE = 4;   // neighborhood detail
        else if (height > 100)    targetSSE = 2;    // street-level
        else if (height > 30)     targetSSE = 0;    // close inspection
        else                      targetSSE = 0;    // extreme close-up

        // Smooth lerp toward target so SSE doesn't jump abruptly
        _pointCloudTileset.maximumScreenSpaceError = lerp(
            _pointCloudTileset.maximumScreenSpaceError,
            targetSSE,
            0.1   // blend factor — increase for snappier response
        );
    });

    // ── 4. Adaptive quality — protect FPS ────────────────────
    //
    //  If the renderer drops below 30 FPS the SSE ceiling is
    //  raised (less detail). When FPS recovers it gradually
    //  creeps back down toward the altitude-driven target.
    let frameCount = 0;
    let lastFPSSample = performance.now();

    viewer.scene.postRender.addEventListener(() => {
        if (!_pointCloudTileset) return;

        frameCount++;
        const now = performance.now();

        if (now - lastFPSSample >= 1_000) {
            const fps = frameCount;
            frameCount = 0;
            lastFPSSample = now;

            if (fps < 30) {
                // Raise SSE cap — load fewer tiles
                _pointCloudTileset.maximumScreenSpaceError = Math.min(
                    256,
                    _pointCloudTileset.maximumScreenSpaceError * 1.4
                );
            }
            // Recovery is handled passively by the LOD lerp above
        }
    });
}

// ── Helper ─────────────────────────────────────────────────────
function lerp(a, b, t) {
    return a + (b - a) * t;
}



/* ========================================================
    PREVENT FALLING THROUGH THE POINT CLOUD

    3D Tile point clouds have no collision -- by default the camera
    can fly straight through them. This keeps the camera above the
    cloud's actual surface: every frame, right before rendering, it
    picks the point cloud directly under the crosshair -- below you
    when looking down, ahead of you when looking more level -- and if
    the camera has drifted closer to that surface than
    MIN_DISTANCE_TO_SURFACE, pushes it back out along the line from
    the surface to the camera until it's exactly that far away again.

    Because this runs every single frame regardless of what moved the
    camera -- mouse wheel zoom, orbiting, our own sync code -- any
    zoom-in that would cross the floor gets continuously cancelled
    back out to it, which is what gives the "asymptotic" feel: you
    can get arbitrarily close to the surface but never past it, and
    the floor itself tracks wherever the point cloud's surface
    actually is under the crosshair rather than being one fixed
    altitude for the whole scene.
   ======================================================== */

const MIN_DISTANCE_TO_SURFACE = 2; // meters

viewer.scene.preRender.addEventListener(() => {
    if (!_pointCloudTileset) return; // nothing loaded yet to collide with

    const canvas = viewer.scene.canvas;
    const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);

    // Point clouds render as discrete points with gaps between them
    // (more so the closer you get), so a single pixel at dead-center
    // often misses entirely -- sample a small cluster around the
    // crosshair and keep whichever hit is nearest to the camera.
    const SAMPLE_OFFSETS = [
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 10],
        [0, -10],
    ];

    let nearestPoint;
    let nearestDistance = Infinity;

    for (const [dx, dy] of SAMPLE_OFFSETS) {
        const pixel = new Cartesian2(center.x + dx, center.y + dy);
        const picked = viewer.scene.pickPosition(pixel);
        if (!picked) continue;

        const distance = Cartesian3.distance(viewer.camera.position, picked);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = picked;
        }
    }

    if (!nearestPoint || nearestDistance >= MIN_DISTANCE_TO_SURFACE) return;

    // Too close: push the camera back out along the (surface -> camera)
    // direction until it's exactly MIN_DISTANCE_TO_SURFACE away.
    const pushBackDirection = Cartesian3.normalize(
        Cartesian3.subtract(viewer.camera.position, nearestPoint, new Cartesian3()),
        new Cartesian3()
    );
    viewer.camera.position = Cartesian3.add(
        nearestPoint,
        Cartesian3.multiplyByScalar(pushBackDirection, MIN_DISTANCE_TO_SURFACE, new Cartesian3()),
        new Cartesian3()
    );
});



/* ========================================================
    SYNC BUTTON
    The button will, when pressed, set the view of the 3d
    map to the view of the 2d map.

    This reuses the exact same resolution <-> distance formula as the
    continuous 2D -> 3D sync below (see the ZOOM section of
    syncCesiumFrom2D) instead of Cesium's own camera.setView({
    destination: Rectangle }) fitting. That built-in fit sizes the
    camera to whatever CESIUM's own viewport aspect ratio happens to
    be, which isn't necessarily the same aspect ratio view2d used to
    calculate the extent in the first place -- if the two map panels
    aren't pixel-for-pixel the same shape, that mismatch alone can
    make the button's result look "more zoomed" than the 2D map, even
    though nothing else about the sync is malfunctioning. Reusing the
    shared formula sidesteps the question entirely: the button and
    the continuous sync are now guaranteed to agree, by construction.
   ======================================================== */

const button = document.getElementById('sync-button');
button.addEventListener('click', () => {
  const [lon, lat] = toLonLat(view2d.getCenter());
  const groundResolution = view2d.getResolution() * Math.cos(CesiumMath.toRadians(lat));

  const canvas = viewer.scene.canvas;
  const fovy = viewer.camera.frustum.fovy;
  const height = (groundResolution * canvas.clientHeight) / (2 * Math.tan(fovy / 2));

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(lon, lat, height, ellipsoid),
    orientation: { heading: 0.0, pitch: CesiumMath.toRadians(-90), roll: 0.0 },
  });
});





/* ========================================================
    CONTINUOUS SYNC: 2D -> 3D
    (this was labeled "3D to 2D" before -- it's the other way
    round: view2d drives viewer.camera)

    Whenever the 2D map's view changes -- including mid-drag, not
    just on release -- the Cesium camera is corrected so that the
    ground point at the center of its screen matches the 2D map's
    center, and its distance to that point matches the 2D map's
    zoom level.

    Unlike the previous version, this does NOT accumulate per-frame
    deltas. Every tick it re-derives the correction from the current
    ABSOLUTE state of both maps (where the camera is actually
    looking right now, vs. where OL's center actually is right now),
    so there's no drift if a frame gets dropped or the tab is
    backgrounded for a while.

    It also never touches heading/pitch/roll -- only camera position
    is corrected, so any tilt/orbit you've set up in the 3D view
    (e.g. while inspecting the point cloud) survives a 2D pan/zoom
    instead of being snapped back to top-down.
   ======================================================== */

const view2d = map2d.getView();

// viewer was created with `globe: false` above, so there's no
// viewer.scene.globe to hang an ellipsoid off of -- use the WGS84
// ellipsoid directly instead, wherever one is needed below.
const ellipsoid = Ellipsoid.WGS84;

// Shared re-entrancy guards between this direction and 3D -> 2D
// below. Each handler calls its own markSyncing*() right before
// writing to the OTHER map; the other handler's guard clears the
// flag itself the moment it sees it set (a "consume once" pattern),
// rather than clearing it after a fixed delay.
//
// The original version cleared these with setTimeout(fn, 0), which
// is exactly what let the two directions loop: Cesium's `changed`
// and `moveEnd` events (and even OpenLayers' own event dispatch
// through view.fit()) don't necessarily arrive before a 0ms timeout
// resolves -- so the guard was frequently already cleared by the
// time the echo it was supposed to catch showed up, and the echo
// went through unguarded, triggering the other direction, which
// triggered this one again, indefinitely. Consuming the flag on
// receipt instead means it stays up for exactly as long as it
// actually takes the echo to arrive, however long that is.
let isSyncingFromCesium = false;
let isSyncingFromOl = false;

// Safety-net timers: if a marked flag is never actually consumed --
// e.g. the write was too small to cross Cesium's `changed` threshold
// or register as a `moveEnd` -- this clears it after a short delay so
// a fluke can't lock a whole sync direction out permanently. Each is
// cancelled the moment its flag IS consumed normally, so in ordinary
// use these essentially never fire.
let clearIsSyncingFromCesiumFallback = null;
let clearIsSyncingFromOlFallback = null;

function markSyncingFromCesium() {
  isSyncingFromCesium = true;
  clearTimeout(clearIsSyncingFromCesiumFallback);
  clearIsSyncingFromCesiumFallback = setTimeout(() => {
    isSyncingFromCesium = false;
  }, 250);
}

function markSyncingFromOl() {
  isSyncingFromOl = true;
  clearTimeout(clearIsSyncingFromOlFallback);
  clearIsSyncingFromOlFallback = setTimeout(() => {
    isSyncingFromOl = false;
  }, 250);
}

let syncScheduled = false;

function scheduleSync() {
  if (syncScheduled) {
    return;
  }

  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncCesiumFrom2D();
  });
}

view2d.on("change:resolution", scheduleSync);
view2d.on("change:center", scheduleSync);

function syncCesiumFrom2D() {
  if (isSyncingFromCesium) {
    // Consumed: this view2d change was our own echo from the 3D -> 2D
    // handler a moment ago, not a real user pan/zoom. Swallow it.
    isSyncingFromCesium = false;
    clearTimeout(clearIsSyncingFromCesiumFallback);
    return;
  }

  const canvas = viewer.scene.canvas;
  const screenCenter = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);

  // Where the 3D camera is CURRENTLY looking, on the ground. If the
  // camera is tilted up past the horizon there's no such point, and
  // nothing sensible to align to -- just skip this tick.
  const currentGroundPoint = pickGroundPoint(screenCenter);
  if (!currentGroundPoint) return;

  /*=========================
             PAN
  =========================*/

  const [targetLon, targetLat] = toLonLat(view2d.getCenter());
  const currentHeight = Cartographic.fromCartesian(currentGroundPoint, ellipsoid).height;
  const targetGroundPoint = Cartesian3.fromDegrees(targetLon, targetLat, currentHeight, ellipsoid);

  // East/north/up frame at the current ground point: lets us resolve
  // (target - current) into "meters east" / "meters north" regardless
  // of the camera's own heading, then apply that same offset to the
  // camera position directly (translating the camera by a fixed
  // vector doesn't depend on which point you defined the vector at).
  const enuMatrix = Transforms.eastNorthUpToFixedFrame(currentGroundPoint, ellipsoid);
  const eastAxis = Matrix4.getColumn(enuMatrix, 0, new Cartesian3());
  const northAxis = Matrix4.getColumn(enuMatrix, 1, new Cartesian3());

  const delta = Cartesian3.subtract(targetGroundPoint, currentGroundPoint, new Cartesian3());
  const eastMeters = Cartesian3.dot(delta, eastAxis);
  const northMeters = Cartesian3.dot(delta, northAxis);

  const movement = Cartesian3.add(
    Cartesian3.multiplyByScalar(eastAxis, eastMeters, new Cartesian3()),
    Cartesian3.multiplyByScalar(northAxis, northMeters, new Cartesian3()),
    new Cartesian3()
  );

  markSyncingFromOl();

  viewer.camera.position = Cartesian3.add(viewer.camera.position, movement, new Cartesian3());

  /*==========================
              ZOOM
  ==========================*/

  // Web Mercator resolution is equator-referenced; scale by cos(lat)
  // to get true ground meters-per-pixel at the target latitude.
  const groundResolution = view2d.getResolution() * Math.cos(CesiumMath.toRadians(targetLat));

  // A camera with vertical field of view `fovy`, `canvasHeight` px
  // tall, sees a ground extent of 2 * distance * tan(fovy / 2). Solve
  // for the distance that would show the same ground resolution OL is
  // showing.
  const fovy = viewer.camera.frustum.fovy;
  const targetDistance = (groundResolution * canvas.clientHeight) / (2 * Math.tan(fovy / 2));

  // Distance from the camera to where it's now pointing -- note this
  // uses targetGroundPoint (where the pan step above just aimed the
  // camera), not the pre-pan currentGroundPoint. Using the stale
  // pre-pan point here was a real bug: after moving the camera
  // sideways by some pan vector delta, its distance to that old point
  // is sqrt(height^2 + |delta|^2) -- always LARGER than the true
  // height, never smaller. That made every pan look like the camera
  // had drifted too far away and needed to move closer, even when
  // zoom hadn't changed at all -- a one-directional bias that
  // compounds with every single pan, which is exactly why the 3D map
  // kept creeping more zoomed-in than the 2D one over time.
  const currentDistance = Cartesian3.distance(viewer.camera.position, targetGroundPoint);
  const zoomMovement = currentDistance - targetDistance;

  // Plain subtraction, not a trig ratio -- this can't blow up the way
  // dividing by sin(pitch) could when the camera is level (pitch 0).
  if (zoomMovement > 0) {
    viewer.camera.moveForward(zoomMovement);
  } else if (zoomMovement < 0) {
    viewer.camera.moveBackward(-zoomMovement);
  }
}

// Casts a ray from the camera through a screen pixel and intersects
// it with the WGS84 ellipsoid. Returns a Cartesian3, or undefined if
// the ray doesn't hit the ellipsoid at all (e.g. camera tilted up
// past the horizon).
function pickGroundPoint(pixel) {
  const ray = viewer.camera.getPickRay(pixel);
  if (!ray) return undefined;
  const hit = IntersectionTests.rayEllipsoid(ray, ellipsoid);
  if (!hit) return undefined;
  return Ray.getPoint(ray, hit.start);
}



/* ========================================================
    CONTINUOUS SYNC: 3D -> 2D

    The other direction: whenever the Cesium camera moves -- again,
    continuously, not just once it stops -- work out what it's
    actually looking at and update view2d to match.

    A single center + zoom can only describe a top-down view. Once
    the camera tilts, what it sees is a foreshortened trapezoid on
    the ground, not a rectangle centered under it, so:

      - near top-down (pitch within ~8 deg of straight down): behave
        like a normal 2D map sync -- set view2d's center to the
        ground point under the crosshair, and its zoom to match the
        camera's distance from that point.
      - tilted beyond that: fit view2d to the camera's ground
        footprint instead (see computeViewFootprint below), which is
        the closest a flat 2D map can get to "showing what the 3D
        camera sees".

    The footprint -- and a dot for the ground point under the
    crosshair -- are also drawn on the 2D map as a vector overlay in
    both cases, so tilt is visible on the 2D map even while it's
    still changing.
   ======================================================== */

const TOP_DOWN_PITCH_THRESHOLD_DEG = 8;

const footprintSource = new VectorSource();
const footprintLayer = new VectorLayer({
  source: footprintSource,
  style: new Style({
    stroke: new Stroke({ color: "#e0a458", width: 2 }),
    fill: new Fill({ color: "rgba(224, 164, 88, 0.12)" }),
  }),
});
map2d.addLayer(footprintLayer);

// Two permanent, empty-until-updated features: the footprint polygon
// and a dot for the point directly under the camera's crosshair.
const footprintFeature = new Feature();
const cameraGroundFeature = new Feature();
cameraGroundFeature.setStyle(
  new Style({
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: "#e0a458" }),
      stroke: new Stroke({ color: "#0d1114", width: 1.5 }),
    }),
  })
);
footprintSource.addFeatures([footprintFeature, cameraGroundFeature]);

let cesiumSyncScheduled = false;
function scheduleCesiumSync() {
  if (cesiumSyncScheduled) {
    return;
  }

  cesiumSyncScheduled = true;
  requestAnimationFrame(() => {
    cesiumSyncScheduled = false;
    syncOlFrom3D();
  });
}

// "changed" fires continuously throughout a drag/zoom/orbit, not just
// once at the end -- percentageChanged lowers the threshold for that
// (default 0.5) so it fires on small moves too. moveEnd is the exact,
// unthrottled final correction once the camera settles.
viewer.camera.changed.addEventListener(scheduleCesiumSync);
viewer.camera.percentageChanged = 0.01;
viewer.camera.moveEnd.addEventListener(syncOlFrom3D);

function syncOlFrom3D() {
  if (isSyncingFromOl) {
    // Consumed: this camera change was our own echo from the 2D -> 3D
    // handler a moment ago, not a real user drag/orbit. Swallow it.
    isSyncingFromOl = false;
    clearTimeout(clearIsSyncingFromOlFallback);
    return;
  }

  const canvas = viewer.scene.canvas;
  const screenCenter = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const currentGroundPoint = pickGroundPoint(screenCenter);
  const footprintCorners = computeViewFootprint();

  updateFootprint(footprintCorners, currentGroundPoint);

  if (!currentGroundPoint) return; // camera pointed entirely off the globe (open sky)

  const currentCartographic = Cartographic.fromCartesian(currentGroundPoint, ellipsoid);
  const lon = CesiumMath.toDegrees(currentCartographic.longitude);
  const lat = CesiumMath.toDegrees(currentCartographic.latitude);

  const pitchDeg = CesiumMath.toDegrees(viewer.camera.pitch);
  const isTopDown = Math.abs(pitchDeg - -90) < TOP_DOWN_PITCH_THRESHOLD_DEG;

  markSyncingFromCesium();

  if (isTopDown) {
    const distance = Cartesian3.distance(viewer.camera.position, currentGroundPoint);
    const fovy = viewer.camera.frustum.fovy;
    const groundResolution = (2 * distance * Math.tan(fovy / 2)) / canvas.clientHeight;
    const resolution = groundResolution / Math.cos(CesiumMath.toRadians(lat));
    const zoom = view2d.getZoomForResolution(resolution);

    view2d.setCenter(fromLonLat([lon, lat]));
    if (zoom !== undefined) view2d.setZoom(zoom);
  } else if (footprintCorners.length >= 3) {
    // Tilted: no single zoom represents this view, so show the
    // ground extent actually visible instead of a misleading center.
    const extent = boundingExtent(footprintCorners.map((lonLat) => fromLonLat(lonLat)));
    view2d.fit(extent, { padding: [20, 20, 20, 20], duration: 0, maxZoom: 19 });
  }
}

// The camera's ground footprint, as up to four [lon, lat] corners in
// screen-corner order (TL, TR, BR, BL). A corner is omitted if that
// particular ray doesn't hit the ellipsoid (camera tilted up past the
// horizon on that side).
function computeViewFootprint() {
  const canvas = viewer.scene.canvas;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const screenCorners = [
    new Cartesian2(0, 0),
    new Cartesian2(w, 0),
    new Cartesian2(w, h),
    new Cartesian2(0, h),
  ];

  return screenCorners
    .map((pixel) => {
      const point = pickGroundPoint(pixel);
      if (!point) return null;
      const carto = Cartographic.fromCartesian(point, ellipsoid);
      return [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)];
    })
    .filter((lonLat) => lonLat !== null);
}

// groundCornersLonLat: [lon, lat][] (3+ needed to draw a polygon)
// cameraGroundPoint: Cartesian3 | undefined -- the point under the
// crosshair, already computed by the caller, so this doesn't redo it.
function updateFootprint(groundCornersLonLat, cameraGroundPoint) {
  if (groundCornersLonLat.length >= 3) {
    const ring = groundCornersLonLat.map((lonLat) => fromLonLat(lonLat));
    ring.push(ring[0]);
    footprintFeature.setGeometry(new Polygon([ring]));
  } else {
    footprintFeature.setGeometry(null);
  }

  if (cameraGroundPoint) {
    const carto = Cartographic.fromCartesian(cameraGroundPoint, ellipsoid);
    const lonLat = [CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)];
    cameraGroundFeature.setGeometry(new Point(fromLonLat(lonLat)));
  } else {
    cameraGroundFeature.setGeometry(null);
  }
}