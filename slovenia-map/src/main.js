import "./style.css";

// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import GeoJSON from "ol/format/GeoJSON.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import WebGLTileLayer from "ol/layer/WebGLTile.js";
import {toLonLat, fromLonLat, transform} from "ol/proj.js";
import GeoTIFF from "ol/source/GeoTIFF.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";

// Cesium
import {
  Viewer, 
  Cartesian3,
  Rectangle,
  Cesium3DTileset,
  Cartographic,
  Math as CesiumMath,
  Transforms,
  Matrix4,
  Cartesian2,
  HeadingPitchRoll,
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

        // Calculate relative height
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
    SYNC BUTTON
    The button will, when pressed, set the view of the 3d
    map to the view of the 2d map.
   ======================================================== */

const button = document.getElementById('sync-button');
button.addEventListener('click', () => {
  const extent = map2d.getView().calculateExtent(map2d.getSize());

  // Convert extent to longitude/latitude
  const southwest = toLonLat([extent[0], extent[1]]);
  const northeast = toLonLat([extent[2], extent[3]]);


  const west = southwest[0];
  const south = southwest[1];
  const east = northeast[0];
  const north = northeast[1];

  viewer.camera.setView({
    destination: Rectangle.fromDegrees(west, south, east, north),
    //orientation: new HeadingPitchRoll()
  });
})





/* ========================================================
    SYNCHRONIZATION OF 3D TO 2D
   ======================================================== */
   
const view2d = map2d.getView();


let syncScheduled = false;

function scheduleSync() {
  if (syncScheduled) {
    return;
  }

  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncCesium();
  });
}

view2d.on("change:resolution", scheduleSync);
view2d.on("change:center", scheduleSync);




let previousCenter = view2d.getCenter();
let previousResolution = view2d.getResolution();

function syncCesium() {
  /*=========================
             PAN
  =========================*/
  const currentCenter = view2d.getCenter();
  
  const dx = currentCenter[0] - previousCenter[0];
  const dy = currentCenter[1] - previousCenter[1];
  
  
  previousCenter = currentCenter;
  
  const cartographic =
  Cartographic.fromCartesian(
    viewer.camera.position
  );
  
  const latitude = cartographic.latitude;
  
  const scale = Math.cos(CesiumMath.toRadians(latitude));
  
  const east = dx * scale;
  const north = dy * scale;
  
  moveCameraEastNorth(east, north);
  
  /*==========================
              ZOOM
  ==========================*/
 
  const currentResolution = view2d.getResolution();

  // Approximate height that the camera is at (at the new zoom level)
  const olHeight = currentResolution * map2d.getSize()[1];

  // Previous Cesium camera height (this we want to change)
  let previousOlHeight = previousResolution * map2d.getSize()[1];

  // const zoomFactorLog = CesiumMath.log2(previousResolution / currentResolution);
  // To calculate the height difference, we need a connection between resolution and height
  
  const heightDifference = olHeight - previousOlHeight;
  previousResolution = currentResolution;
  const cesiumPitch = viewer.camera.pitch;

  // Zoom sensitivity should ideally depend on the orientation of the camera (the more tilted the camera,
  // the stronger the zooming)
  // Idea for the formula: zoomSensitivity = height / cos(pitch)

  const zoomMovement = heightDifference / (Math.cos(CesiumMath.PI_OVER_TWO - cesiumPitch));    
  
  if (zoomMovement > 0) {
    viewer.camera.moveForward(zoomMovement);
  } else if (zoomMovement < 0) {
    viewer.camera.moveBackward(-zoomMovement);
  }
}



function moveCameraEastNorth(east, north) {

    const cameraPosition = viewer.camera.position;

    const enuMatrix =
        Transforms.eastNorthUpToFixedFrame(cameraPosition);

    const eastVector = Matrix4.getColumn(
        enuMatrix,
        0,
        new Cartesian3()
    );

    const northVector = Matrix4.getColumn(
        enuMatrix,
        1,
        new Cartesian3()
    );

    const movement = new Cartesian3();

    Cartesian3.multiplyByScalar(
        eastVector,
        east,
        movement
    );

    Cartesian3.add(
        movement,
        Cartesian3.multiplyByScalar(
            northVector,
            north,
            new Cartesian3()
        ),
        movement
    );

    const newPosition = Cartesian3.add(
        cameraPosition,
        movement,
        new Cartesian3()
    );

    viewer.camera.position = newPosition;
}
