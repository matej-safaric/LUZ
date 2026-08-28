import "./style.css";

import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
import { createCesiumViewer } from "./cesiumMapInit";
import { setupMapSync } from "./syncMaps";
import { createOLMap } from "./olMapInit";



export let viewer = null;
let mapSync = null;

// Create OL map:
export let map2d = createOLMap();

viewer = createCesiumViewer();
mapSync = setupMapSync(map2d, viewer);