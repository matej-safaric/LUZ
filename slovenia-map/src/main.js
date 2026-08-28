import "./style.css";

import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
import { createCesiumViewer } from "./cesiumMapInit";
import { setupMapSync } from "./syncMaps";
import { createOLMap } from "./olMapInit";
import { setupSyncButton, callSyncButton } from "./syncButton";


export let viewer = null;
let mapSync = null;

// Create OL map:
export let map2d = createOLMap();


const app = document.getElementById('app');
const toggle3DButton = document.getElementById('toggle-3d-button');

let threeDVisible = false;

function show3D() {
    app.classList.add('side-by-side')

    if (!viewer) {
        viewer = createCesiumViewer();
        mapSync = setupMapSync(map2d, viewer);
        setupSyncButton(viewer, map2d.getView());
    } else {
        callSyncButton(viewer, map2d.getView());
        mapSync.enable();
    };
};

function hide3D() {
    app.classList.remove('side-by-side');

    if (mapSync) {
        mapSync.disable();
    }
}


toggle3DButton.addEventListener('click', () => {
    if (threeDVisible) {
        hide3D();
        toggle3DButton.textContent = 'Show 3D';
    } else {
        show3D();
        toggle3DButton.textContent = 'Hide 3D';
    }

    threeDVisible = !threeDVisible;
});