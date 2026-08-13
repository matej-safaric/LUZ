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
  Cartesian3,
  Rectangle,
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




map2d.on("moveend", () => {
  const extent = map2d.getView().calculateExtent(map2d.getSize());
  
  // Convert extent to longitude/latitude
  const southwest = toLonLat([extent[0], extent[1]]);
  const northeast = toLonLat([extent[2], extent[3]]);


  const west = southwest[0];
  const south = southwest[1];
  const east = northeast[0];
  const north = northeast[1];

  viewer.camera.flyTo({
    destination: Rectangle.fromDegrees(west, south, east, north)
  })

  // Optional immediate teleport to destination
  // viewer.camera.completeFlight()
});
