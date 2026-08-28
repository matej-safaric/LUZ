// Cesium
import { 
    Math as CesiumMath,
    Cartesian3,
    Ellipsoid,
} from "cesium";

// OL
import { toLonLat } from "ol/proj";






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


export function setupSyncButton(viewer, view2d) {
  const button = document.getElementById('sync-button');
  button.addEventListener('click', callSyncButton(viewer, view2d));
}

export function callSyncButton(viewer, view2d) {
  const ellipsoid = Ellipsoid.WGS84;

  const [lon, lat] = toLonLat(view2d.getCenter());
  const groundResolution = view2d.getResolution() * Math.cos(CesiumMath.toRadians(lat));

  const canvas = viewer.scene.canvas;
  const fovy = viewer.camera.frustum.fovy;
  const height = (groundResolution * canvas.clientHeight) / (2 * Math.tan(fovy / 2));

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(lon, lat, height, ellipsoid),
    orientation: { heading: 0.0, pitch: CesiumMath.toRadians(-90), roll: 0.0 },
  });
};