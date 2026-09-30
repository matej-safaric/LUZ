import { 
    Color,
    Cartesian2,
    Cartesian3,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    Ray,
    LabelStyle,
    VerticalOrigin,
    HorizontalOrigin,
 } from "cesium";

import Point from 'ol/geom/Point.js';
import Feature from "ol/Feature";
import { fromLonLat } from "ol/proj";
import { Math as CesiumMath } from "cesium";
import { Cartographic } from "cesium";
import Style from "ol/style/Style";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";


/* ========================================================
    POINT MODE

    Lets the user click points directly onto the point cloud's actual
    surface. While active:
      - a marker follows the mouse, snapped to whichever point cloud
        surface is actually under the cursor (hidden whenever the
        cursor isn't over any rendered point cloud geometry, e.g.
        empty sky or a not-yet-loaded area) -- reuses the same
        pickNearestPointCloudHit sampling as the collision guard above
      - clicking commits the currently hovered point: it's added to
        selectedPoints and gets a permanent marker of its own

    Deliberately does NOT fall back to the flat ellipsoid the way
    pickGroundPoint does elsewhere in this file -- a placed point is
    meant to BE a real point cloud sample for later measurement, not
    an approximate guess, so if nothing is actually hit, hovering
    shows no marker and clicking does nothing.

    selectedPoints is what the planned distance/area/volume tools will
    read from. Each entry keeps the entity alongside its position so a
    future "remove point" / "undo" action just needs to delete that
    entity and splice the array -- no separate lookup needed.
   ======================================================== */
let pointModeActive = false;
const selectedPoints = []; // { id, position: Cartesian3, entity: Entity }[]

let nextPointId = 1;

const POINT_COLOR = Color.fromCssColorString("#59c7d6");
const HOVER_COLOR = Color.fromCssColorString("#e0a458").withAlpha(0.85);
const POINT_OUTLINE_COLOR = Color.fromCssColorString("#0d1114");

const pointModeStyle = new Style({
    image: new CircleStyle({
        radius: 8,
        fill: new Fill({
            color: '#59c7d6',
        }),
        stroke: new Stroke({
            color: '#0d1114',
            width: 2
        })
    })
});






export function setupPointMode(viewer, map2d, mainPointModeActive) {
    pointModeActive = mainPointModeActive;
    // A single reusable entity for the hover highlight -- repositioned   
    // (and shown/hidden) on every hover update rather than recreated.
    const hoverEntity = viewer.entities.add({
        show: false,
        point: {
            pixelSize: 10,
            color: HOVER_COLOR,
            outlineColor: POINT_OUTLINE_COLOR,
            outlineWidth: 2,
            // Keep the highlight visible even when it's technically behind
            // other points from this angle -- it's a UI crosshair, not
            // scene geometry, so it shouldn't get lost in the point cloud.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },    
    });   

    // Throttled to one pick per animation frame, same pattern as the 2D
    // <-> 3D sync scheduling elsewhere -- mousemove can fire
    // far more often than that, and scene.pickPosition (times 5 samples)
    // isn't free.
    let hoverUpdateScheduled = false;
    let pendingHoverPixel = null;

    function scheduleHoverUpdate(pixel) {
        // Cesium reuses/mutates the Cartesian2 objects it hands to event
        // callbacks, so it has to be cloned here -- storing the reference
        // as-is would mean pendingHoverPixel silently changes out from
        // under us before the rAF callback below gets to read it.
        pendingHoverPixel = Cartesian2.clone(pixel);

        if (hoverUpdateScheduled) return;
        hoverUpdateScheduled = true;
        requestAnimationFrame(() => {
            hoverUpdateScheduled = false;
            updateHoverMarker(pendingHoverPixel);
        });
    }

    function updateHoverMarker(pixel) {
        if (!pointModeActive) return;

        const picked = pickNearestPointCloudHit(pixel, viewer);
        if (picked) {
            const pickedCoordinates = {
                x: Math.round((picked.x + Number.EPSILON) * 100) / 100,
                y: Math.round((picked.y + Number.EPSILON) * 100) / 100,
                z: Math.round((picked.z + Number.EPSILON) * 100) / 100,
            };
            hoverEntity.position = picked;
            hoverEntity.label = {
                text: `(${pickedCoordinates.x}, ${pickedCoordinates.y}, ${pickedCoordinates.z})`,
                font: "14px sans-serif",
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 3,
                backgroundColor: Color.BLACK,
                showBackground: true,

                // Position the label next to the point
                style: LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cartesian2(10, -10),

                // Optional: keep it visible at a reasonable distance
                verticalOrigin: VerticalOrigin.BOTTOM,
                horizontalOrigin: HorizontalOrigin.LEFT
            }

            hoverEntity.show = true;
        } else {
            hoverEntity.show = false;
        }
    }

    const pointModeHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    function setupPointModeEventHandler() {
        pointModeHandler.setInputAction((movement) => {
            if (!pointModeActive) return;
            scheduleHoverUpdate(movement.endPosition);
        }, ScreenSpaceEventType.MOUSE_MOVE);

        pointModeHandler.setInputAction((click) => {
            if (!pointModeActive) return;

            const picked = pickNearestPointCloudHit(click.position, viewer);
            if (!picked) return; // clicked somewhere with no point cloud under the cursor

            const pickedCoordinates = {
                x: Math.round((picked.x + Number.EPSILON) * 100) / 100,
                y: Math.round((picked.y + Number.EPSILON) * 100) / 100,
                z: Math.round((picked.z + Number.EPSILON) * 100) / 100,
            };

            const entity = viewer.entities.add({
                position: picked,
                point: {
                    pixelSize: 12,
                    color: POINT_COLOR,
                    outlineColor: POINT_OUTLINE_COLOR,
                    outlineWidth: 2,
                    disableDepthTestDistance: 0,
                },
                label: {
                    text: `(${pickedCoordinates.x}, ${pickedCoordinates.y}, ${pickedCoordinates.z})`,
                    font: "14px sans-serif",
                    fillColor: Color.WHITE,
                    outlineColor: Color.BLACK,
                    outlineWidth: 3,
                    backgroundColor: Color.BLACK,
                    showBackground: true,

                    // Position the label next to the point
                    style: LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cartesian2(10, -10),

                    // Optional: keep it visible at a reasonable distance
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    horizontalOrigin: HorizontalOrigin.LEFT
                }
            });

            selectedPoints.push({ id: nextPointId++, position: picked, entity });
            
            // Also draw the point onto the OL map:
            const cartographic = Cartographic.fromCartesian(picked);

            const lon = CesiumMath.toDegrees(cartographic.longitude);
            const lat = CesiumMath.toDegrees(cartographic.latitude);

            const mapPointXY = fromLonLat([lon, lat]);
            const olPoint = new Feature({
                geometry: new Point(mapPointXY)
            });

            // We must fetch the 'drawings' layer's source from map2d:
            const layers = map2d.getLayers();
            const layer = layers.getArray().find(
                layer => layer.get('id') === 'drawings'
            );
            const drawingSource = layer?.getSource();

            olPoint.setStyle(pointModeStyle);
            drawingSource.addFeature(olPoint);
        }, ScreenSpaceEventType.LEFT_CLICK);
    }

    setupPointModeEventHandler();

    function enable(mainPointModeActive) {
        pointModeActive = mainPointModeActive;
        if (pointModeActive) return;

        pointModeActive = true;
        setupPointModeEventHandler();
        return pointModeActive
    }

    function disable(mainPointModeActive) {
        pointModeActive = mainPointModeActive;
        if (!pointModeActive) return;

        pointModeActive = false;
        pointModeHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
        pointModeHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
        return pointModeActive
    }

    return {
        enable, 
        disable
    }
}


function pickNearestPointCloudHit(centerPixel, viewer) {
    const SAMPLE_OFFSETS = [
        [0, 0],
        [5, 0],
        [-5, 0],
        [0, 5],
        [0, -5],
        [5, 5],
        [-5, -5],
        [5, -5],
        [-5, 5],
    ];

    let nearestPoint;
    let nearestDistance = Infinity;

    for (const [dx, dy] of SAMPLE_OFFSETS) {
        const pixel = new Cartesian2(centerPixel.x + dx, centerPixel.y + dy);
        
        // First, verify we actually picked something in the scene
        const pickedObject = viewer.scene.pick(pixel);
        if (!pickedObject) continue;

        // Try to get position - this will prefer the picked feature
        let picked = viewer.scene.pickPosition(pixel);
        if (!picked) continue;

        // Optional: Add a sanity check - ensure the picked point is reasonably close
        // to the camera ray (filters out points picked on wrong geometry)
        const pickRay = viewer.camera.getPickRay(pixel);
        const distanceToRay = Cartesian3.distance(
            picked,
            Ray.getPoint(pickRay, Cartesian3.distance(viewer.camera.position, picked))
        );
        
        // Skip if point is too far from the ray (likely wrong geometry)
        if (distanceToRay > 100) continue; // Adjust threshold as needed

        const distance = Cartesian3.distance(viewer.camera.position, picked);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = picked;
        }
    }

    return nearestPoint;
}