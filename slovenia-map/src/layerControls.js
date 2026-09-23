// Builds a row of buttons — one per 2D raster layer — inside `container`,
// letting the user pick which layer is visible on the OL map.
//
// Current behavior: single-select (radio-button style), matching
// setActiveLayer() in olMapInit.js, which hides every other raster layer
// whenever one is chosen.
//
// TO ALLOW MULTIPLE ACTIVE LAYERS LATER:
//   1. In olMapInit.js, replace setActiveLayer(id) with something like
//      toggleLayer(id) that just flips that one layer's visibility
//      (layer.setVisible(!layer.getVisible())) instead of hiding the rest.
//   2. Here, swap the <button> for a checkbox (or keep buttons but track an
//      active Set instead of a single id), and stop clearing the other
//      buttons' "active" class on each click.
//   3. Optional niceties once several layers can show at once: an opacity
//      slider per layer (layer.setOpacity()), and up/down reorder buttons
//      per layer (layer.setZIndex()) so the user controls draw order.
export function setupLayerControls(container, rasterLayers, setActiveLayer) {
    container.innerHTML = '';

    if (rasterLayers.length === 0) {
        container.textContent = 'No 2D layers found.';
        return;
    }

    rasterLayers.forEach((layer) => {
        const id = layer.get('id');
        const title = layer.get('title') ?? id;

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        button.dataset.layerId = id;
        button.classList.toggle('active', layer.getVisible());

        button.addEventListener('click', () => {
            setActiveLayer(id);
            container.querySelectorAll('button').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.layerId === id);
            });
        });

        container.appendChild(button);
    });
}