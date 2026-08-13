import "./style.css";

// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import OSM from "ol/source/OSM.js";
import {fromLonLat} from "ol/proj.js";

// Cesium
import {
  Viewer, 
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

