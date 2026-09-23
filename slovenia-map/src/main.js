import "./style.css";

import "cesium/Build/Cesium/Widgets/widgets.css";

// Other modules
import { createCesiumViewer } from "./cesiumMapInit";
import { setupMapSync } from "./syncMaps";
import { createOLMap } from "./olMapInit";
import { setupSyncButton, callSyncButton } from "./syncButton";
import { setupPointMode } from "./pointMode";
import { setupLineMode } from "./lineMode";
import { setupLayerControls } from "./layerControls";


export let viewer = null;
export let map2d = null;

let mapSync = null;


// createOLMap() now needs to fetch the layers manifest first, so it's async.
// Everything that depends on map2d/the layer buttons lives inside init(),
// which runs once that fetch resolves.
async function init() {
    const { map, rasterLayers, setActiveLayer } = await createOLMap();
    map2d = map;

    const layerControlsContainer = document.getElementById('layer-2d-controls');
    if (layerControlsContainer) {
        setupLayerControls(layerControlsContainer, rasterLayers, setActiveLayer);
    }

    setupUI();
}

function setupUI() {
    // 3D view:

    const app = document.getElementById('app');
    const toggle3DButton = document.getElementById('toggle-3d-button');

    let threeDVisible = false;

    function show3D() {
        app.classList.add('side-by-side')

        if (!viewer) {
            viewer = createCesiumViewer();
            mapSync = setupMapSync(map2d, viewer);
            setupSyncButton(viewer, map2d.getView());
            mapSync.enable()
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



    // Point Mode:

    let pointModeActive = false;
    let pointMode = null;

    const togglePointModeButton = document.getElementById('point-mode-button');
    togglePointModeButton.addEventListener('click', () => {
        if (!threeDVisible) return;

        pointModeActive = !pointModeActive;
        if (!pointModeActive) {
            stopPointMode();
            togglePointModeButton.textContent = 'Enter Point mode';
        } else {
            startPointMode();
            togglePointModeButton.textContent = 'Exit point mode';
        }

    });

    function startPointMode() {
        if (!pointMode) {
            pointMode = setupPointMode(viewer, map2d, pointModeActive);
        } else {
            pointMode.enable();
        }
    }

    function stopPointMode() {
        if (pointMode) {
            pointMode.disable();
        }
    }



    // Line Mode:

    let lineModeActive = false;
    let lineMode = null;

    const toggleLineModeButton = document.getElementById('line-mode-button');
    toggleLineModeButton.addEventListener('click', () => {
        if (!threeDVisible) return;

        lineModeActive = !lineModeActive;
        if (!lineModeActive) {
            stopLineMode();
            toggleLineModeButton.textContent = 'Enter Line mode';
        } else {
            startLineMode();
            toggleLineModeButton.textContent = 'Exit Line mode';
        }

    });

    function startLineMode() {
        if (!lineMode) {
            lineMode = setupLineMode(viewer, map2d, lineModeActive);
        } else {
            lineMode.enable();
        }
    }

    function stopLineMode() {
        if (lineMode) {
            lineMode.disable();
        }
    }




    // 3D Layers (roads, polygons)
    const roadsButton = document.getElementById("roads-button");
    const polygonsButton = document.getElementById("polygons-button");


    roadsButton.addEventListener("click", () => {
        if (!threeDVisible) return;

        const roadsDataSource = viewer.dataSources.getByName('roadsGeoJSONSource')[0];

        const checked = roadsButton.getAttribute("aria-pressed") === "true";
        const newState = !checked;

        roadsButton.setAttribute("aria-pressed", newState);

        if (newState) {
        // Checked
        roadsDataSource.show = true;
        roadsButton.textContent = "✓ Roads"
        } else {
        // Unchecked
        roadsDataSource.show = false;
        roadsButton.textContent = "Roads"
        }
    })

    polygonsButton.addEventListener("click", () => {
        if (!threeDVisible) return;

        const polygonsDataSource = viewer.dataSources.getByName('polygonsGeoJSONSource')[0];

        const checked = polygonsButton.getAttribute("aria-pressed") === "true";
        const newState = !checked;

        polygonsButton.setAttribute("aria-pressed", newState);

        if (newState) {
        // Checked
        polygonsDataSource.show = true;
        polygonsButton.textContent = "✓ Polygons"
        } else {
        // Unchecked
        polygonsDataSource.show = false;
        polygonsButton.textContent = "Polygons"
        }
    })
};


init();