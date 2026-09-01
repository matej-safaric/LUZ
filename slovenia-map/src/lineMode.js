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
    CallbackProperty,
 } from "cesium";


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
let lineModeActive = false;
const selectedPoints = []; // { id, position: Cartesian3, entity: Entity }[]

let nextPointId = 1;

const POINT_COLOR = Color.fromCssColorString("#5993d6");
const HOVER_COLOR = Color.fromCssColorString("#e06c58").withAlpha(0.85);
const POINT_OUTLINE_COLOR = Color.fromCssColorString("#0d1114");

 
let previousPoint = null;
// The actual Cartesian3 for previousPoint, kept separately because
// previousPoint.position is a PositionProperty (Cesium wraps whatever
// Cartesian3 you pass to entities.add), not a Cartesian3 itself. Polyline
// `positions` arrays need raw Cartesian3s -- mixing in a Property object
// silently produces NaN geometry and eventually crashes the renderer.
let previousPointPosition = null;
let hoverEntity = null;
let hoverLengthLabel = null;
// The hover polyline's current end position, read every frame by the
// CallbackProperty below rather than being pushed into the entity directly.
let hoverPickedPosition = null;

// Full 9-point sweep used to bridge gaps between individual rendered
// points in the cloud. Used for the click handler, where accuracy matters
// more than speed and it only runs once per click.
const FULL_SAMPLE_OFFSETS = [
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
// Cheap single-sample check used for hover, which runs on every animation
// frame the mouse moves. scene.pick + scene.pickPosition are each an
// offscreen render pass, so doing all 9 offsets every frame (18 render
// passes/frame) is what was causing the hover marker/line to lag behind
// the cursor. Most of the time the cursor is over solid point-cloud
// surface, so a single center sample is enough; the full sweep is only
// used as a fallback when that misses (see pickNearestPointCloudHit below).
const CENTER_SAMPLE_OFFSET = [[0, 0]];




export function setupLineMode(viewer, mainLineModeActive) {
    lineModeActive = mainLineModeActive;
    // A single reusable entity for the hover highlight -- repositioned   
    // (and shown/hidden) on every hover update rather than recreated.
    hoverEntity = viewer.entities.add({
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
        // Label and polyline are created once here, with just the static
        // styling filled in. updateHoverMarker() below only ever mutates
        // .text / .show on these (and the module-level variables the
        // polyline's positions callback reads) from here on -- rebuilding
        // the whole LabelGraphics/PolylineGraphics object every animation
        // frame (as the previous version did) is unnecessary allocation
        // and property-parsing overhead on the hottest path in the file.
        label: {
            text: "",
            font: "14px sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            backgroundColor: Color.BLACK,
            showBackground: true,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(10, -10),
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.LEFT,
        },
        polyline: {
            show: false,
            // A CallbackProperty, not a plain array, is what makes Cesium
            // treat this polyline as dynamic. A plain array (or reassigning
            // a new array each frame, as the previous version did) becomes
            // a ConstantProperty, and Cesium combines ConstantProperty
            // polyline geometry asynchronously in a web worker on the
            // assumption it won't change often. Every reassignment then
            // cancels/restarts that combine job, so the line only catches
            // up once the worker manages to finish -- visibly, once the
            // mouse stops moving. A CallbackProperty is instead evaluated
            // directly on the main thread every frame, with no worker
            // round-trip, so it tracks the cursor immediately.
            positions: new CallbackProperty(() => {
                if (!previousPointPosition || !hoverPickedPosition) {
                    return [Cartesian3.ZERO, Cartesian3.ZERO];
                }
                return [previousPointPosition, hoverPickedPosition];
            }, false),
        },
    });   

    hoverLengthLabel = viewer.entities.add({
        show: false,
        label: {
            text: "",
            font: "12px sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            backgroundColor: Color.fromCssColorString("#000000AA"),
            showBackground: true,
            style: LabelStyle.FILL_AND_OUTLINE,
        }
    });

    // Throttled to one pick per animation frame, same pattern as the 2D
    // <-> 3D sync scheduling elsewhere -- mousemove can fire
    // far more often than that, and scene.pickPosition isn't free.
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
        if (!lineModeActive) return;

        // Cheap single-sample attempt first; only pay for the full 9-point
        // sweep on the rarer frames where the cursor lands in a gap
        // between rendered points.
        const picked =
            pickNearestPointCloudHit(pixel, viewer, CENTER_SAMPLE_OFFSET) ??
            pickNearestPointCloudHit(pixel, viewer, FULL_SAMPLE_OFFSETS);

        if (picked) {
            const pickedCoordinates = {
                x: Math.round((picked.x + Number.EPSILON) * 100) / 100,
                y: Math.round((picked.y + Number.EPSILON) * 100) / 100,
                z: Math.round((picked.z + Number.EPSILON) * 100) / 100,
            };
            hoverEntity.position = picked;
            hoverEntity.label.text = `(${pickedCoordinates.x}, ${pickedCoordinates.y}, ${pickedCoordinates.z})`;
            hoverPickedPosition = picked;

            // The CallbackProperty on the polyline reads previousPointPosition
            // and hoverPickedPosition directly every frame -- only .show needs
            // to be toggled here.
            hoverEntity.polyline.show = Boolean(previousPointPosition);

            hoverEntity.show = true;
        } else {
            hoverEntity.show = false;
        }

        if (picked && previousPointPosition) {
            const distance = Cartesian3.distance(previousPointPosition, picked);
            const midpoint = Cartesian3.midpoint(previousPointPosition, picked, new Cartesian3());
            
            hoverLengthLabel.position = midpoint;
            hoverLengthLabel.label.text = distance.toFixed(2) + " m"; // or your preferred unit
            hoverLengthLabel.show = true;
        } else {
            hoverLengthLabel.show = false;
        }
    }

    const lineModeHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    function setupLineModeEventHandler() {
        lineModeHandler.setInputAction((movement) => {
            if (!lineModeActive) return;
            scheduleHoverUpdate(movement.endPosition);
        }, ScreenSpaceEventType.MOUSE_MOVE);

        lineModeHandler.setInputAction((click) => {
            if (!lineModeActive) return;

            // Clicks are infrequent (unlike hover, which runs every frame),
            // so it's worth always paying for the full accurate sweep here.
            const picked = pickNearestPointCloudHit(click.position, viewer, FULL_SAMPLE_OFFSETS);
            if (!picked) return; // clicked somewhere with no point cloud under the cursor

            const pickedCoordinates = {
                x: Math.round((picked.x + Number.EPSILON) * 100) / 100,
                y: Math.round((picked.y + Number.EPSILON) * 100) / 100,
                z: Math.round((picked.z + Number.EPSILON) * 100) / 100,
            };
            let entity = null;
            if (previousPointPosition) {
                entity = viewer.entities.add({
                    position: picked,
                    point: {
                        pixelSize: 12,
                        color: POINT_COLOR,
                        outlineColor: POINT_OUTLINE_COLOR,
                        outlineWidth: 2,
                        disableDepthTestDistance: 0,//Number.POSITIVE_INFINITY,
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
                    },
                    polyline: {
                        positions: [
                            previousPointPosition,
                            picked,
                        ],
                        width: 2,
                    }
                });
                const distance = Cartesian3.distance(previousPointPosition, picked);
                const midpoint = Cartesian3.midpoint(previousPointPosition, picked, new Cartesian3());

                // Add this alongside the entity creation:
                viewer.entities.add({
                    position: midpoint,
                    label: {
                        text: distance.toFixed(2) + " m",
                        font: "12px sans-serif",
                        fillColor: Color.WHITE,
                        outlineColor: Color.BLACK,
                        outlineWidth: 2,
                        backgroundColor: Color.fromCssColorString("#000000AA"),
                        showBackground: true,
                        style: LabelStyle.FILL_AND_OUTLINE,
                    }
                });
            } else {
                entity = viewer.entities.add({
                    position: picked,
                    point: {
                        pixelSize: 12,
                        color: POINT_COLOR,
                        outlineColor: POINT_OUTLINE_COLOR,
                        outlineWidth: 2,
                        disableDepthTestDistance: 0,//Number.POSITIVE_INFINITY,
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
                    },
                });
            }

            selectedPoints.push({ id: nextPointId++, position: picked, entity });
            previousPoint = entity;
            previousPointPosition = picked;
        }, ScreenSpaceEventType.LEFT_CLICK);
    }

    setupLineModeEventHandler();

    function enable(mainLineModeActive) {
        lineModeActive = mainLineModeActive;
        if (lineModeActive) return;

        lineModeActive = true;
        previousPoint = null;
        previousPointPosition = null;
        hoverPickedPosition = null;
        setupLineModeEventHandler();
        return lineModeActive
    }

    function disable(mainLineModeActive) {
        lineModeActive = mainLineModeActive;
        if (!lineModeActive) return;

        lineModeActive = false;
        lineModeHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE);
        lineModeHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
        return lineModeActive
    }

    return {
        enable, 
        disable
    }
}


function pickNearestPointCloudHit(centerPixel, viewer, sampleOffsets) {
    let nearestPoint;
    let nearestDistance = Infinity;

    for (const [dx, dy] of sampleOffsets) {
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