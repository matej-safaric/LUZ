import './style.css';
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';

const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM()
    })
  ],
  view: new View({
    center: [0, 0],
    zoom: 2
  })
});



// const map = new Map({
//   target: "map",
//   layers: [
//     baseLayer,
//     orthoLayer,
//     cadastralLayer,
//   ],
//   view: new View({
//     projection: "EPSG:3857",
//     center: fromLonLat([14.5, 46.05]),
//     zoom: 9,
//   }),
// });