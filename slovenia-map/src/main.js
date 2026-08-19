import "./style.css";

// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import GeoJSON from "ol/format/GeoJSON.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import {toLonLat, fromLonLat} from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";

// Cesium
import {
  Viewer, 
  Cartesian3,
  Rectangle,
  Cesium3DTileset,
  Cartographic,
  Math,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";





// OL map:

const baseLayer = new TileLayer({
  source: new OSM(),
});

// // Additional 2D GeoJSON layer:

const pointLayer = new VectorLayer({
    source: new VectorSource({
        url: "/data/ljubljanaPoint.geojson",

        format: new GeoJSON(),
    }),
});


const map2d = new Map({
  target: 'map-2d',

  layers: [
    baseLayer,
    pointLayer,
  ],

  view: new View({
    center: fromLonLat([14.5058, 46.0569]),
    zoom: 8,
  }),
});

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
    // const cartographic = Cartographic.fromCartesian(
    //     viewer.camera.position
    // );

    // console.log(
    //     "Camera longitude:",
    //     Math.toDegrees(cartographic.longitude)
    // );

    // console.log(
    //     "Camera latitude:",
    //     Math.toDegrees(cartographic.latitude)
    // );

    // console.log(
    //     "Camera height:",
    //     cartographic.height
    // );
  };



/* =============================
    SYNCHRONIZATION OF 3D TO 2D
   ============================= */

const view2d = map2d.getView();

let syncScheduled = false;

view2d.on("change:center", () => {      // It seems enough for now to only consider 'change:center'
  if (syncScheduled) {
    return;
  }

  syncScheduled = true;

  requestAnimationFrame(() => {
    syncScheduled = false;
    syncCesium();
  });
});


let syncCesium = function() {
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
  });
  // Optional immediate teleport to destination:
  // viewer.camera.completeFlight()
};