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

async function loadPointCloud() {
    const tileset = await Cesium3DTileset.fromUrl(
        "/pointcloud/tiles/tileset.json"
    );

    viewer.scene.primitives.add(tileset);

    await viewer.zoomTo(tileset);
  };




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
