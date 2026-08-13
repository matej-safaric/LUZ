import "./style.css";

// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import OSM from "ol/source/OSM.js";
import {toLonLat, fromLonLat} from "ol/proj.js";

// Cesium
import {
  Viewer, 
  Cartesian3
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";


const map2d = new Map({
  target: 'map-2d',

  layers: [
    new TileLayer({
      source: new OSM(),
    }),
  ],

  view: new View({
    center: fromLonLat([14.5058, 46.0569]),
    zoom: 8,
  }),
});


const viewer = new Viewer('map-3d', {
  animation: false,
  timeline: false,
});



const button = document.getElementById("sync-button");

button.addEventListener('click', () => {
  const centerWebMercator = map2d.getView().getCenter();

  const [longitude, latitude] = toLonLat(centerWebMercator);

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      longitude, 
      latitude,
      10000,
    ),
  });

  // Optional immediate teleport to destination
  // viewer.camera.completeFlight()
});