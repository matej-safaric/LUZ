// OpenLayers
import Map from "ol/Map.js";
import View from "ol/View.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import WebGLTileLayer from "ol/layer/WebGLTile.js";
import {toLonLat, fromLonLat, transform} from "ol/proj.js";
import {boundingExtent} from "ol/extent.js";
import GeoTIFF from "ol/source/GeoTIFF.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import CircleStyle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";


// Other modules
import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";



// ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
// OpenLayers map initialization
// ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

// We define EPSG:3794 (otherwise OL gets confused)
proj4.defs(
    "EPSG:3794",
    "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 " +
    "+x_0=500000 +y_0=-5000000 " +
    "+ellps=GRS80 +units=m +no_defs"
);
register(proj4);




export function createOLMap() {
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



    // Map

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


    return map2d;
};