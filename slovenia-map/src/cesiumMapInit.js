// Cesium
import {
  Viewer, 
  Cartesian3,
  Cesium3DTileset,
  Math as CesiumMath,
  Cartesian2,
  HeadingPitchRange,
  GeoJsonDataSource,
  Color,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";




// ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
// Cesium map initialization
// ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

// The 3D map is toggleable, so we must package the initialization 
// into a function that can be called elsewhere.


export function createCesiumViewer() {
// Cesium map:
    const viewer = new Viewer('map-3d', {
    animation: false,
    timeline: false,
    globe: false,
    selectionIndicator: false,
    });





    loadPointCloud();
    const roadsGeoJSONSource = GeoJsonDataSource.load("/data/draped.geojson", {
        stroke: Color.RED,
        fill: Color.RED.withAlpha(0.4),
        strokeWidth: 2,
        show: false
        }
    ).then((roadsGeoJSONSource) => {

        roadsGeoJSONSource.name = "roadsGeoJSONSource";

        viewer.dataSources.add(roadsGeoJSONSource);
        roadsGeoJSONSource.show = false;
    });
    // roadsGeoJSONSource.name = 'roadsGeoJSONSource'
    // viewer.dataSources.add(roadsGeoJSONSource);
    
    // ─────────────────────────────────────────────────────────────
    //  Optimized Point Cloud Loader
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
                CesiumMath.toRadians(-90), // pitch: looking down 45°
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

    return viewer;
}