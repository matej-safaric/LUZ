// OpenLayers
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import VectorLayer from "ol/layer/Vector.js";
import {toLonLat, fromLonLat } from "ol/proj.js";
import {boundingExtent} from "ol/extent.js";
import VectorSource from "ol/source/Vector.js";
import CircleStyle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";

// Cesium
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Transforms,
  Matrix4,
  Cartesian2,
  IntersectionTests,
  Ellipsoid,
  Ray,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
// import { map2d } from "./olMapInit";
// import { viewer } from "./cesiumMapInit";

export function setupMapSync(map2d, viewer) {
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
    let show3DEnabled = false

    const view2d = map2d.getView();

    //                        | viewer was created with `globe: false` above, so there's no
    //    Claude's comment -> | viewer.scene.globe to hang an ellipsoid off of -- use the WGS84
    //                        | ellipsoid directly instead, wherever one is needed below.
    //
    // In actuality, we will create a custom ellipsoid that has slightly
    // larger radii. In this way, we make sure that our intersection tests
    // return similar results to what we would want from intersecting 
    // the point cloud itself.
    const HEIGHT_DIFFERENCE = 281.68;

    const ellipsoid = new Ellipsoid(
        Ellipsoid.WGS84.radii.x + HEIGHT_DIFFERENCE, 
        Ellipsoid.WGS84.radii.y + HEIGHT_DIFFERENCE, 
        Ellipsoid.WGS84.radii.z + HEIGHT_DIFFERENCE
    )

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


    // ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
    //  Auxilliary functions for disabling/enabling sync
    // ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

    function enable() {
        if (show3DEnabled) {
            return;
        }
        show3DEnabled = true;
        view2d.on('change:center', scheduleSync);
        view2d.on('change:resolution', scheduleSync);
        viewer.camera.changed.addEventListener(scheduleCesiumSync);
        viewer.camera.moveEnd.addEventListener(syncOlFrom3D);
    };

    function disable() {
        if (!show3DEnabled) {
            return;
        }
        show3DEnabled = false;
        view2d.un('change:center', scheduleSync);
        view2d.un('change:resolution', scheduleSync);
        viewer.camera.changed.removeEventListener(scheduleCesiumSync); 
        viewer.camera.moveEnd.removeEventListener(syncOlFrom3D);
   
    };

    return {
        enable,
        disable,
    };
};
