import "./style.css";

import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
import { createCesiumViewer } from "./cesiumMapInit";
import { setupMapSync } from "./syncMaps";
import { createOLMap } from "./olMapInit";
import { setupSyncButton, callSyncButton } from "./syncButton";
import { setupPointMode } from "./pointMode";


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






let pointModeActive = false;
let pointMode = null;

const togglePointModeButton = document.getElementById('point-mode-button');
togglePointModeButton.addEventListener('click', () => {
    if (!threeDVisible) return;
    
    pointModeActive = !pointModeActive;
    // console.log(pointModeActive);
    // if (!pointMode) {
    //     pointMode = setupPointMode(viewer, pointModeActive);
    // }
    if (!pointModeActive) {
        stopPointMode();
        togglePointModeButton.textContent = 'Enter Point mode';
    } else {
        startPointMode();
        togglePointModeButton.textContent = 'Exit point mode';
    }
        
});



function startPointMode() {
    // If this is first launch, setup pointMode:
    if (!pointMode) {
        pointMode = setupPointMode(viewer, pointModeActive);
    } else {
        pointMode.enable();
    }
}

function stopPointMode() {
    if (pointMode) {
        pointMode.disable();
    }
}