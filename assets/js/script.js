document.addEventListener('DOMContentLoaded', () => {
    // --- Map Initialization ---
    const mapOptions = { zoomControl: false, attributionControl: true };
    const mapBefore = L.map('map-before', mapOptions).setView([20, 0], 2);
    const mapAfter = L.map('map-after', mapOptions).setView([20, 0], 2);
    let mapChange = null; // Will be initialized when needed

    // --- Basemap Layer Definitions ---
    const basemapLayers = {
        dark: {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        },
        light: {
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri &copy; Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
        }
    };

    // Initialize with dark basemap
    let currentBasemap = 'dark';
    let beforeTileLayer = L.tileLayer(basemapLayers.dark.url, { attribution: basemapLayers.dark.attribution }).addTo(mapBefore);
    let afterTileLayer = L.tileLayer(basemapLayers.dark.url, { attribution: basemapLayers.dark.attribution }).addTo(mapAfter);
    let changeTileLayer = null;

    L.control.zoom({ position: 'bottomright' }).addTo(mapBefore);
    L.control.zoom({ position: 'bottomright' }).addTo(mapAfter);

    // Add scale controls to main maps (standard Leaflet scale)
    L.control.scale({ 
        position: 'bottomleft',
        imperial: false,
        metric: true
    }).addTo(mapBefore);
    
    L.control.scale({ 
        position: 'bottomleft',
        imperial: false,
        metric: true
    }).addTo(mapAfter);

    // --- State Management ---
    const state = {
        before: { map: mapBefore, layer: null, file: null, geojson: null },
        after: { map: mapAfter, layer: null, file: null, geojson: null },
        change: { map: null, layer: null, geojson: null },
        syncEnabled: true,
        selectedAttribute: null,
        colorMap: {},
        changeResults: null,
        transitionColorMap: {},
        legend: {
            mode: 'attribute',
            selectedKey: null
        },
        panels: {
            statsVisible: false
        },
        currentBasemap: 'dark'
    };

    const LEGEND_MODES = {
        ATTRIBUTE: 'attribute',
        CHANGE: 'change'
    };

    const UNCHANGED_KEY = '__UNCHANGED__';
    const VIEW_ALL_KEY = '__VIEW_ALL__';

    const legendToggleBtn = document.getElementById('legend-toggle-btn');
    const statsToggleBtn = document.getElementById('stats-toggle-btn');
    const downloadReportBtn = document.getElementById('download-report-btn');
    const mapLayerBtn = document.getElementById('map-layer-btn');
    const mapLayerMenu = document.getElementById('map-layer-menu');
    const layerOptions = document.querySelectorAll('.layer-option');

    // --- Color Palette ---
    function generateColorPalette(count) {
        const colors = [];
        const hueStep = 360 / count;
        for (let i = 0; i < count; i++) {
            const hue = (i * hueStep) % 360;
            colors.push(`hsl(${hue}, 70%, 60%)`);
        }
        return colors;
    }

    function getDistinctValues(geojson, attribute) {
        const values = new Set();
        geojson.features.forEach(feature => {
            if (feature.properties && feature.properties[attribute] !== undefined) {
                values.add(feature.properties[attribute]);
            }
        });
        return Array.from(values);
    }

    function createColorMap(distinctValues) {
        const colors = generateColorPalette(distinctValues.length);
        const colorMap = {};
        distinctValues.forEach((value, index) => {
            colorMap[value] = colors[index];
        });
        return colorMap;
    }

    function getFeatureStyle(feature, colorMap, attribute) {
        const value = feature.properties[attribute];
        const color = colorMap[value] || '#888888';
        return {
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.5
        };
    }

    // --- Basemap Layer Switching ---
    function switchBasemap(layerType) {
        if (!basemapLayers[layerType] || state.currentBasemap === layerType) return;

        const newLayer = basemapLayers[layerType];
        state.currentBasemap = layerType;

        // Switch before map
        mapBefore.removeLayer(beforeTileLayer);
        beforeTileLayer = L.tileLayer(newLayer.url, { attribution: newLayer.attribution });
        beforeTileLayer.addTo(mapBefore);

        // Switch after map
        mapAfter.removeLayer(afterTileLayer);
        afterTileLayer = L.tileLayer(newLayer.url, { attribution: newLayer.attribution });
        afterTileLayer.addTo(mapAfter);

        // Switch change map if it exists
        if (state.change.map && changeTileLayer) {
            state.change.map.removeLayer(changeTileLayer);
            changeTileLayer = L.tileLayer(newLayer.url, { attribution: newLayer.attribution });
            changeTileLayer.addTo(state.change.map);
        }

        // Update active state in menu
        layerOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.layer === layerType);
        });
    }

    // --- Legend ---
    function registerLegendItemEvents(item) {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.addEventListener('click', legendItemClickHandler);
        item.addEventListener('keydown', legendItemKeyHandler);
    }

    function legendItemClickHandler(event) {
        event.preventDefault();
        handleLegendItemActivation(event.currentTarget);
    }

    function legendItemKeyHandler(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleLegendItemActivation(event.currentTarget);
        }
    }

    function handleLegendItemActivation(element) {
        const key = element.dataset.legendKey;
        const mode = element.dataset.legendMode;

        if (!key || !mode) return;

        state.legend.mode = mode;

        if (key === VIEW_ALL_KEY) {
            if (mode === LEGEND_MODES.ATTRIBUTE) {
                resetAttributeStyles();
            } else if (mode === LEGEND_MODES.CHANGE) {
                resetChangeStyles();
            }
            state.legend.selectedKey = null;
            setActiveLegendItem(VIEW_ALL_KEY);
            return;
        }

        if (state.legend.mode === mode && state.legend.selectedKey === key) {
            clearLegendHighlight();
            return;
        }

        state.legend.selectedKey = key;
        applyLegendHighlight(mode, key);
        setActiveLegendItem(key);
    }

    function setActiveLegendItem(key) {
        const items = document.querySelectorAll('#legend-content .legend-item');
        items.forEach(item => {
            const isActive = key !== null && item.dataset.legendKey === key && item.dataset.legendMode === state.legend.mode;
            item.classList.toggle('active', !!isActive);
        });
    }

    function applyLegendHighlight(mode, key) {
        if (mode === LEGEND_MODES.ATTRIBUTE) {
            highlightAttributeValue(key);
        } else if (mode === LEGEND_MODES.CHANGE) {
            highlightChangeValue(key);
        }
    }

    function clearLegendHighlight() {
        if (state.legend.mode === LEGEND_MODES.ATTRIBUTE) {
            resetAttributeStyles();
        } else if (state.legend.mode === LEGEND_MODES.CHANGE) {
            resetChangeStyles();
        }
        state.legend.selectedKey = null;
        setActiveLegendItem(VIEW_ALL_KEY);
    }

    function resetLegendState(mode) {
        state.legend.mode = mode;
        state.legend.selectedKey = null;
        setActiveLegendItem(VIEW_ALL_KEY);
        if (mode === LEGEND_MODES.ATTRIBUTE) {
            resetAttributeStyles();
        } else if (mode === LEGEND_MODES.CHANGE) {
            resetChangeStyles();
        }
    }

    function highlightAttributeValue(value) {
        if (!state.selectedAttribute || value === undefined || value === null) return;

        ['before', 'after'].forEach(key => {
            const layer = state[key].layer;
            if (!layer) return;

            layer.eachLayer(featureLayer => {
                const feature = featureLayer.feature;
                const baseStyle = getFeatureStyle(feature, state.colorMap, state.selectedAttribute);
                const featureValue = feature.properties ? feature.properties[state.selectedAttribute] : null;
                const normalizedFeatureValue = featureValue !== undefined && featureValue !== null ? String(featureValue) : '';
                const matches = normalizedFeatureValue === value;

                featureLayer.setStyle({
                    ...baseStyle,
                    opacity: matches ? 1 : 0.2,
                    fillOpacity: matches ? Math.min(baseStyle.fillOpacity + 0.2, 1) : 0.05,
                    weight: matches ? baseStyle.weight + 1 : 1
                });

                if (matches && featureLayer.bringToFront) {
                    featureLayer.bringToFront();
                }
            });
        });
    }

    function resetAttributeStyles() {
        if (!state.selectedAttribute) return;
        ['before', 'after'].forEach(key => {
            const layer = state[key].layer;
            if (!layer) return;

            layer.eachLayer(featureLayer => {
                featureLayer.setStyle(
                    getFeatureStyle(featureLayer.feature, state.colorMap, state.selectedAttribute)
                );
            });
        });
    }

    function getChangeTransitionKey(feature) {
        if (!feature || !feature.properties) return null;
        if (feature.properties.status !== 'changed') {
            return UNCHANGED_KEY;
        }
        return `${feature.properties.before_value} → ${feature.properties.after_value}`;
    }

    function getChangeFeatureStyle(feature) {
        if (!feature || !feature.properties) return {};

        if (feature.properties.status !== 'changed') {
            return {
                color: '#10b981',
                weight: 1,
                fillColor: '#10b981',
                fillOpacity: 0.3,
                opacity: 1
            };
        }

        const transition = getChangeTransitionKey(feature);
        const color = (state.transitionColorMap && state.transitionColorMap[transition]) || '#f59e0b';
        return {
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.7,
            opacity: 1
        };
    }

    function highlightChangeValue(key) {
        if (!state.change.layer || !key) return;

        state.change.layer.eachLayer(featureLayer => {
            const feature = featureLayer.feature;
            const baseStyle = getChangeFeatureStyle(feature);
            const transitionKey = getChangeTransitionKey(feature);
            const matches = transitionKey === key;

            featureLayer.setStyle({
                ...baseStyle,
                opacity: matches ? 1 : 0.2,
                fillOpacity: matches ? Math.min(baseStyle.fillOpacity + 0.2, 1) : 0.05,
                weight: matches ? baseStyle.weight + 1 : 1
            });

            if (matches && featureLayer.bringToFront) {
                featureLayer.bringToFront();
            }
        });
    }

    function resetChangeStyles() {
        if (!state.change.layer) return;
        state.change.layer.eachLayer(featureLayer => {
            featureLayer.setStyle(getChangeFeatureStyle(featureLayer.feature));
        });
    }

    function createViewAllLegendItem(mode) {
        const item = document.createElement('div');
        item.className = 'legend-item view-all';
        item.innerHTML = `
            <div class="legend-color" style="background-color: transparent; border-style: dashed;"></div>
            <div class="legend-label">View All</div>
        `;
        item.dataset.legendKey = VIEW_ALL_KEY;
        item.dataset.legendMode = mode;
        registerLegendItemEvents(item);
        return item;
    }

    function setLegendVisibility(visible) {
        const panel = document.getElementById('legend-panel');
        if (!panel) return;
        panel.classList.toggle('hidden', !visible);
        if (legendToggleBtn) {
            legendToggleBtn.classList.toggle('active', visible);
        }
    }

    function setStatsPanelVisibility(visible) {
        const panel = document.getElementById('stats-panel');
        if (!panel) return;
        panel.classList.toggle('hidden', !visible);
        state.panels.statsVisible = visible;
        if (statsToggleBtn) {
            statsToggleBtn.classList.toggle('active', visible);
        }
    }

    if (legendToggleBtn) {
        legendToggleBtn.addEventListener('click', () => {
            const panel = document.getElementById('legend-panel');
            const isHidden = panel.classList.contains('hidden');
            setLegendVisibility(isHidden);
        });
    }

    if (statsToggleBtn) {
        statsToggleBtn.addEventListener('click', () => {
            if (statsToggleBtn.disabled) return;
            const nextVisibility = !state.panels.statsVisible;
            setStatsPanelVisibility(nextVisibility);
        });
    }

    // Map Layer Menu
    if (mapLayerBtn && mapLayerMenu) {
        mapLayerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mapLayerMenu.classList.toggle('hidden');
        });

        layerOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerType = option.dataset.layer;
                switchBasemap(layerType);
                mapLayerMenu.classList.add('hidden');
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!mapLayerBtn.contains(e.target) && !mapLayerMenu.contains(e.target)) {
                mapLayerMenu.classList.add('hidden');
            }
        });

        // Set initial active state
        layerOptions.forEach(option => {
            if (option.dataset.layer === state.currentBasemap) {
                option.classList.add('active');
            }
        });
    }

    function showLegend(colorMap, attribute) {
        const panel = document.getElementById('legend-panel');
        const content = document.getElementById('legend-content');
        const header = panel.querySelector('.legend-header h3');

        content.innerHTML = '';
        if (header) {
            header.textContent = attribute ? `${attribute} Legend` : 'Legend';
        }

        const viewAllItem = createViewAllLegendItem(LEGEND_MODES.ATTRIBUTE);
        content.appendChild(viewAllItem);

        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: var(--glass-border); margin: 0.5rem 0;';
        content.appendChild(separator);

        Object.entries(colorMap).forEach(([value, color]) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-color" style="background-color: ${color}"></div>
                <div class="legend-label">${value}</div>
            `;
            item.dataset.legendKey = String(value);
            item.dataset.legendMode = LEGEND_MODES.ATTRIBUTE;
            registerLegendItemEvents(item);
            content.appendChild(item);
        });

        resetLegendState(LEGEND_MODES.ATTRIBUTE);
        const shouldBeVisible = !panel.classList.contains('hidden');
        setLegendVisibility(shouldBeVisible);
    }

    function updateChangeLegend(transitionColorMap) {
        const panel = document.getElementById('legend-panel');
        const content = document.getElementById('legend-content');
        const header = panel.querySelector('.legend-header h3');

        header.textContent = 'Change Legend';
        content.innerHTML = '';

        const viewAllItem = createViewAllLegendItem(LEGEND_MODES.CHANGE);
        content.appendChild(viewAllItem);

        const viewAllSeparator = document.createElement('div');
        viewAllSeparator.style.cssText = 'height: 1px; background: var(--glass-border); margin: 0.5rem 0;';
        content.appendChild(viewAllSeparator);

        // Add unchanged (green) first
        const unchangedItem = document.createElement('div');
        unchangedItem.className = 'legend-item';
        unchangedItem.innerHTML = `
            <div class="legend-color" style="background-color: #10b981"></div>
            <div class="legend-label">Unchanged</div>
        `;
        unchangedItem.dataset.legendKey = UNCHANGED_KEY;
        unchangedItem.dataset.legendMode = LEGEND_MODES.CHANGE;
        registerLegendItemEvents(unchangedItem);
        content.appendChild(unchangedItem);

        // Add separator
        const separator = document.createElement('div');
        separator.style.cssText = 'height: 1px; background: var(--glass-border); margin: 0.5rem 0;';
        content.appendChild(separator);

        // Add all transitions
        Object.entries(transitionColorMap).forEach(([transition, color]) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-color" style="background-color: ${color}"></div>
                <div class="legend-label" style="font-size: 0.85rem;">${transition}</div>
            `;
            item.dataset.legendKey = transition;
            item.dataset.legendMode = LEGEND_MODES.CHANGE;
            registerLegendItemEvents(item);
            content.appendChild(item);
        });

        resetLegendState(LEGEND_MODES.CHANGE);
        const shouldBeVisible = !panel.classList.contains('hidden');
        setLegendVisibility(shouldBeVisible);
    }

    document.getElementById('legend-close').addEventListener('click', () => {
        setLegendVisibility(false);
    });

    // --- Attribute Dropdown ---
    function populateAttributeDropdown(geojson) {
        const select = document.getElementById('attribute-select');
        select.innerHTML = '<option value="">Select Attribute Column</option>';

        if (!geojson || !geojson.features || geojson.features.length === 0) return;

        const properties = geojson.features[0].properties;
        if (!properties) return;

        Object.keys(properties).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            select.appendChild(option);
        });

        select.disabled = false;
    }

    // --- Apply Symbology ---
    function applySymbology(attribute) {
        if (!attribute || !state.before.geojson || !state.after.geojson) return;

        const beforeValues = getDistinctValues(state.before.geojson, attribute);
        const afterValues = getDistinctValues(state.after.geojson, attribute);
        const allValues = [...new Set([...beforeValues, ...afterValues])];

        if (allValues.length > 100) {
            alert(`Too many distinct values (${allValues.length}). Please select an attribute with less than 100 unique values.`);
            return;
        }

        state.colorMap = createColorMap(allValues);
        state.selectedAttribute = attribute;

        ['before', 'after'].forEach(key => {
            if (state[key].layer) {
                state[key].map.removeLayer(state[key].layer);
            }

            const layer = L.geoJSON(state[key].geojson, {
                style: (feature) => getFeatureStyle(feature, state.colorMap, attribute),
                onEachFeature: (feature, layer) => {
                    const props = feature.properties;
                    let popupContent = `<div style="color: #000; font-family: 'Outfit', sans-serif;">`;
                    popupContent += `<strong>${attribute}:</strong> ${props[attribute]}<br>`;
                    popupContent += `</div>`;
                    layer.bindPopup(popupContent);
                }
            }).addTo(state[key].map);

            state[key].layer = layer;
        });

        showLegend(state.colorMap, attribute);
    }

    // --- Change Detection Analysis ---
    async function analyzeChanges() {
        if (!state.before.geojson || !state.after.geojson || !state.selectedAttribute) {
            alert('Please upload both files and select an attribute column first.');
            return;
        }

        const statsContent = document.getElementById('stats-content');

        setStatsPanelVisibility(true);
        statsContent.innerHTML = '<div class="stat-loading"><span class="material-icons-round spin">sync</span><p>Analyzing changes...</p></div>';

        // Simulate processing delay for UX
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            const results = performChangeDetection(
                state.before.geojson,
                state.after.geojson,
                state.selectedAttribute
            );

            displayResults(results);
            state.changeResults = results;
            if (statsToggleBtn) {
                statsToggleBtn.disabled = false;
                statsToggleBtn.classList.add('active');
            }
            if (downloadReportBtn) {
                downloadReportBtn.disabled = false;
            }

            // Show change map
            showChangeMap(results.changeFeatures);

        } catch (error) {
            console.error('Change detection error:', error);
            statsContent.innerHTML = '<div class="stat-loading"><p style="color: var(--error);">Error analyzing changes</p></div>';
        }
    }

    function performChangeDetection(beforeGeoJSON, afterGeoJSON, attribute) {
        const changeFeatures = [];
        let totalArea = 0;
        let changedArea = 0;
        let sameArea = 0;

        console.log('Starting change detection...');
        console.log('Before features:', beforeGeoJSON.features.length);
        console.log('After features:', afterGeoJSON.features.length);

        // Process each feature from the "before" dataset
        beforeGeoJSON.features.forEach((beforeFeature, idx) => {
            const beforeValue = beforeFeature.properties[attribute];

            // Find intersecting features in "after" dataset
            afterGeoJSON.features.forEach((afterFeature) => {
                const afterValue = afterFeature.properties[attribute];

                try {
                    // Use Turf.js to calculate intersection
                    const intersection = turf.intersect(beforeFeature, afterFeature);

                    if (intersection) {
                        const area = turf.area(intersection);

                        // Skip tiny slivers (< 0.0001 m²)
                        if (area < 0.0001) return;

                        totalArea += area;

                        const status = beforeValue === afterValue ? 'same' : 'changed';

                        // Create change feature
                        const changeFeature = {
                            type: 'Feature',
                            geometry: intersection.geometry,
                            properties: {
                                before_value: beforeValue,
                                after_value: afterValue,
                                status: status,
                                area_m2: area
                            }
                        };

                        changeFeatures.push(changeFeature);

                        if (status === 'changed') {
                            changedArea += area;
                        } else {
                            sameArea += area;
                        }
                    }
                } catch (e) {
                    // Skip if intersection fails (non-overlapping or invalid geometries)
                }
            });
        });

        console.log('Total intersections found:', changeFeatures.length);
        console.log('Total area:', totalArea);
        console.log('Changed area:', changedArea);

        // Aggregate changes by transition type
        const changeMatrix = {};
        changeFeatures.forEach(feature => {
            if (feature.properties.status === 'changed') {
                const key = `${feature.properties.before_value} → ${feature.properties.after_value}`;
                if (!changeMatrix[key]) {
                    changeMatrix[key] = {
                        from: feature.properties.before_value,
                        to: feature.properties.after_value,
                        area: 0,
                        count: 0
                    };
                }
                changeMatrix[key].area += feature.properties.area_m2;
                changeMatrix[key].count++;
            }
        });

        const changePercentage = totalArea > 0 ? (changedArea / totalArea * 100) : 0;

        return {
            totalArea,
            changedArea,
            sameArea,
            changePercentage,
            changeMatrix: Object.values(changeMatrix).sort((a, b) => b.area - a.area),
            changeFeatures
        };
    }

    function showChangeMap(changeFeatures) {
        // Hide split view, show change view
        document.getElementById('split-view').classList.add('hidden');
        document.getElementById('change-view').classList.remove('hidden');

        // Initialize change map if not already done
        if (!mapChange) {
            mapChange = L.map('map-change', mapOptions).setView([20, 0], 2);
            const currentBasemapConfig = basemapLayers[state.currentBasemap];
            changeTileLayer = L.tileLayer(currentBasemapConfig.url, { attribution: currentBasemapConfig.attribution });
            changeTileLayer.addTo(mapChange);
            L.control.zoom({ position: 'bottomright' }).addTo(mapChange);
            
            // Add scale control to change map
            L.control.scale({ 
                position: 'bottomleft',
                imperial: false,
                metric: true
            }).addTo(mapChange);
            
            state.change.map = mapChange;
        } else if (changeTileLayer && state.change.map) {
            // Ensure change map uses current basemap if it already exists
            const currentBasemapConfig = basemapLayers[state.currentBasemap];
            if (changeTileLayer._url !== currentBasemapConfig.url) {
                state.change.map.removeLayer(changeTileLayer);
                changeTileLayer = L.tileLayer(currentBasemapConfig.url, { attribution: currentBasemapConfig.attribution });
                changeTileLayer.addTo(state.change.map);
            }
        }

        // Remove existing layer
        if (state.change.layer) {
            state.change.map.removeLayer(state.change.layer);
        }

        // Create unique color map for each transition
        const transitionColorMap = {};
        const transitions = new Set();

        changeFeatures.forEach(feature => {
            if (feature.properties.status === 'changed') {
                const transition = `${feature.properties.before_value} → ${feature.properties.after_value}`;
                transitions.add(transition);
            }
        });

        // Generate unique colors for each transition
        const transitionArray = Array.from(transitions);
        const transitionColors = generateColorPalette(transitionArray.length);

        transitionArray.forEach((transition, index) => {
            transitionColorMap[transition] = transitionColors[index];
        });

        // Store for legend
        state.transitionColorMap = transitionColorMap;

        // Create GeoJSON from change features
        const changeGeoJSON = {
            type: 'FeatureCollection',
            features: changeFeatures
        };

        state.change.geojson = changeGeoJSON;

        // Add to map with styling
        const layer = L.geoJSON(changeGeoJSON, {
            style: (feature) => getChangeFeatureStyle(feature),
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                let popupContent = `<div style="color: #000; font-family: 'Outfit', sans-serif;">`;
                popupContent += `<strong>Status:</strong> ${props.status}<br>`;
                popupContent += `<strong>Before:</strong> ${props.before_value}<br>`;
                popupContent += `<strong>After:</strong> ${props.after_value}<br>`;
                popupContent += `<strong>Area:</strong> ${formatArea(props.area_m2)}<br>`;
                popupContent += `</div>`;
                layer.bindPopup(popupContent);
            }
        }).addTo(mapChange);

        state.change.layer = layer;

        // Fit bounds
        if (changeFeatures.length > 0) {
            mapChange.fitBounds(layer.getBounds());
        }

        // Update legend to show transitions
        updateChangeLegend(transitionColorMap);
    }

    // Back to split view
    document.getElementById('back-to-split').addEventListener('click', () => {
        document.getElementById('change-view').classList.add('hidden');
        document.getElementById('split-view').classList.remove('hidden');

        // Invalidate map sizes
        setTimeout(() => {
            mapBefore.invalidateSize();
            mapAfter.invalidateSize();
        }, 100);
    });

    // Handle window resize for mobile responsiveness
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            mapBefore.invalidateSize();
            mapAfter.invalidateSize();
            if (mapChange) {
                mapChange.invalidateSize();
            }
        }, 250);
    });

    // Initial resize check for mobile
    setTimeout(() => {
        mapBefore.invalidateSize();
        mapAfter.invalidateSize();
    }, 100);

    function displayResults(results) {
        const statsContent = document.getElementById('stats-content');

        // Convert areas to hectares
        const totalAreaHa = results.totalArea / 10000;
        const changedAreaHa = results.changedArea / 10000;
        const sameAreaHa = results.sameArea / 10000;

        let html = `
            <div class="stat-card">
                <h4>Overall Change</h4>
                <div class="stat-value">${results.changePercentage.toFixed(2)}%</div>
                <div class="stat-label">Area Changed</div>
            </div>

            <div class="stat-card">
                <h4>Total Area</h4>
                <div class="stat-value">${totalAreaHa.toFixed(2)} ha</div>
                <div class="stat-label">Analyzed Area</div>
            </div>

            <div class="stat-card">
                <h4>Changed vs Unchanged</h4>
                <div style="margin-top: 0.5rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                        <span>Changed:</span>
                        <strong>${changedAreaHa.toFixed(2)} ha (${results.changePercentage.toFixed(2)}%)</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>Unchanged:</span>
                        <strong>${sameAreaHa.toFixed(2)} ha (${(100 - results.changePercentage).toFixed(2)}%)</strong>
                    </div>
                </div>
            </div>
        `;

        if (results.changeMatrix.length > 0) {
            html += `
                <div class="stat-card">
                    <h4>Top Changes (by Area)</h4>
            `;

            results.changeMatrix.slice(0, 10).forEach(change => {
                const transition = `${change.from} → ${change.to}`;
                const changeAreaHa = change.area / 10000;
                const changePercent = (change.area / results.changedArea * 100);

                html += `
                    <div class="change-row" style="flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 200px;">
                            <span style="font-size: 0.9rem;">${transition}</span>
                        </div>
                        <div style="text-align: right; color: var(--text-muted); font-size: 0.85rem;">
                            <div><strong>${changeAreaHa.toFixed(2)} ha</strong></div>
                            <div>${changePercent.toFixed(1)}% of changes</div>
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
        }

        statsContent.innerHTML = html;
    }

    function formatArea(area) {
        // Always return in hectares
        const hectares = area / 10000;
        return `${hectares.toFixed(2)} ha`;
    }

    // --- Download Report Webpage ---
    async function captureMapImage(mapContainer) {
        if (!mapContainer || typeof html2canvas === 'undefined') {
            return null;
        }
        
        try {
            const canvas = await html2canvas(mapContainer, {
                useCORS: true,
                logging: false,
                backgroundColor: '#1e293b',
                scale: 1
            });
            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Error capturing map image:', error);
            return null;
        }
    }

    async function downloadReportWebpage() {
        if (!state.changeResults) {
            alert('Please run change analysis before downloading the report.');
            return;
        }

        if (typeof html2canvas === 'undefined') {
            alert('Report generation library not loaded. Please refresh the page.');
            return;
        }

        const originalContent = downloadReportBtn.innerHTML;
        downloadReportBtn.disabled = true;
        downloadReportBtn.innerHTML = '<span class="material-icons-round spin">sync</span>';

        try {
            // Capture change map image only
            const changeContainer = document.getElementById('map-change');
            const changeImage = await captureMapImage(changeContainer);

            // Generate HTML webpage
            const htmlContent = generateReportHTML(changeImage);

            // Download as HTML file
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
            link.download = `change_analysis_report_${timestamp}.html`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Error generating report:', error);
            alert('Error generating report. Please try again.');
        } finally {
            downloadReportBtn.disabled = false;
            downloadReportBtn.innerHTML = originalContent;
        }
    }

    function generateReportHTML(changeImage) {
        const results = state.changeResults;
        const totalAreaHa = results.totalArea / 10000;
        const changedAreaHa = results.changedArea / 10000;
        const sameAreaHa = results.sameArea / 10000;

        // Prepare GeoJSON data for embedding
        const changeGeoJSON = state.change.geojson || { type: 'FeatureCollection', features: [] };
        const geoJSONString = JSON.stringify(changeGeoJSON).replace(/</g, '\\u003c');
        const transitionColorMap = state.transitionColorMap || {};

        // Build legend data for JavaScript
        const legendData = [
            { key: '__UNCHANGED__', label: 'Unchanged', color: '#10b981', isDashed: false }
        ];
        
        Object.entries(transitionColorMap).forEach(([transition, color]) => {
            legendData.push({
                key: transition,
                label: transition,
                color: color,
                isDashed: false
            });
        });
        
        const legendDataString = JSON.stringify(legendData).replace(/</g, '\\u003c');

        let topChangesHTML = '';
        if (results.changeMatrix && results.changeMatrix.length > 0) {
            topChangesHTML = '<h3>Top Changes (by Area)</h3><div class="table-wrapper"><table><thead><tr><th>#</th><th>Transition</th><th>Area</th><th>% of Changes</th></tr></thead><tbody>';
            results.changeMatrix.forEach((change, index) => {
                const transition = `${change.from} → ${change.to}`;
                const changeAreaHa = change.area / 10000;
                const changePercent = (change.area / results.changedArea * 100);
                topChangesHTML += `<tr>
                    <td>${index + 1}</td>
                    <td>${transition}</td>
                    <td>${changeAreaHa.toFixed(2)} ha</td>
                    <td>${changePercent.toFixed(1)}%</td>
                </tr>`;
            });
            topChangesHTML += '</tbody></table></div>';
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Change Analysis Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #f8fafc;
            padding: 2rem;
            line-height: 1.6;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(30, 41, 59, 0.8);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            color: #94a3b8;
            margin-bottom: 2rem;
        }
        .maps-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }
        .map-card {
            background: rgba(15, 23, 42, 0.6);
            border-radius: 12px;
            padding: 1rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .map-card h3 {
            margin-bottom: 1rem;
            color: #818cf8;
        }
        .map-card img {
            width: 100%;
            height: auto;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        #interactive-map {
            width: 100%;
            height: 600px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin-top: 1rem;
            position: relative;
        }
        .leaflet-top.leaflet-right {
            position: absolute;
        }
        .leaflet-control-legend {
            background: rgba(30, 41, 59, 0.95) !important;
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 12px !important;
            padding: 1rem !important;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
            max-width: 280px;
            max-height: 70vh;
            overflow-y: auto;
        }
        .legend-header {
            color: #818cf8;
            font-weight: 600;
            margin-bottom: 0.75rem;
            font-size: 1rem;
        }
        .legend-item {
            display: flex !important;
            align-items: center !important;
            gap: 0.75rem !important;
            padding: 0.5rem !important;
            margin-bottom: 0.5rem !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            transition: all 0.2s !important;
            border: 1px solid transparent !important;
            user-select: none !important;
            list-style: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            appearance: none !important;
        }
        .legend-item:hover {
            background: rgba(255, 255, 255, 0.1) !important;
        }
        .legend-item.active {
            background: rgba(129, 140, 248, 0.2) !important;
            border-color: #818cf8 !important;
        }
        .legend-color {
            width: 24px !important;
            height: 24px !important;
            border-radius: 4px !important;
            border: 1px solid rgba(255, 255, 255, 0.3) !important;
            flex-shrink: 0 !important;
            display: block !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            appearance: none !important;
        }
        .legend-label {
            font-size: 0.85rem !important;
            word-break: break-word !important;
            color: #f8fafc !important;
            flex: 1 !important;
        }
        .legend-separator {
            height: 1px !important;
            background: rgba(255, 255, 255, 0.2) !important;
            margin: 0.5rem 0 !important;
            border: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            appearance: none !important;
        }
        .legend-dropdown-container {
            background: rgba(15, 23, 42, 0.6);
            border-radius: 12px;
            padding: 0;
            margin: 1rem 0 2rem 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            overflow: hidden;
        }
        .legend-dropdown-toggle {
            width: 100%;
            padding: 1rem;
            background: rgba(30, 41, 59, 0.8);
            border: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            color: #f8fafc;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: 'Outfit', sans-serif;
            transition: background 0.2s;
        }
        .legend-dropdown-toggle:hover {
            background: rgba(129, 140, 248, 0.2);
        }
        .legend-dropdown-arrow {
            transition: transform 0.3s;
            font-size: 0.8rem;
        }
        .legend-dropdown-toggle.active .legend-dropdown-arrow {
            transform: rotate(180deg);
        }
        .legend-dropdown-content {
            padding: 1rem;
            max-height: 400px;
            overflow-y: auto;
        }
        .legend-dropdown-header {
            font-size: 0.9rem;
            font-weight: 600;
            color: #818cf8;
            margin-bottom: 0.75rem;
        }
        .legend-reset-btn-dropdown {
            width: 100%;
            padding: 0.75rem;
            margin-bottom: 0.75rem;
            background: rgba(129, 140, 248, 0.2);
            border: 1px solid #818cf8;
            border-radius: 8px;
            color: #818cf8;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            transition: all 0.2s;
            font-family: 'Outfit', sans-serif;
        }
        .legend-reset-btn-dropdown:hover {
            background: rgba(129, 140, 248, 0.3);
        }
        .legend-dropdown-items {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 0.5rem;
        }
        .legend-dropdown-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
        }
        .legend-dropdown-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .legend-dropdown-item.active {
            background: rgba(129, 140, 248, 0.2);
            border-color: #818cf8;
        }
        .legend-dropdown-color {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            flex-shrink: 0;
        }
        .legend-dropdown-label {
            font-size: 0.85rem;
            color: #f8fafc;
            word-break: break-word;
        }
        @media (min-width: 769px) {
            .legend-dropdown-container {
                display: none;
            }
        }
        .stats-section {
            background: rgba(15, 23, 42, 0.6);
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        .stat-card {
            background: rgba(30, 41, 59, 0.8);
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .stat-card h4 {
            color: #94a3b8;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-label {
            color: #94a3b8;
            font-size: 0.9rem;
            margin-top: 0.25rem;
        }
        .table-wrapper {
            max-height: 400px;
            overflow-y: auto;
            margin-top: 1rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        table th, table td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        table th {
            background: rgba(30, 41, 59, 0.8);
            color: #818cf8;
            font-weight: 600;
        }
        table tr:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        .footer {
            text-align: center;
            color: #94a3b8;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }
            .container {
                padding: 1rem;
            }
            h1 {
                font-size: 1.8rem;
            }
            .maps-section {
                grid-template-columns: 1fr;
                gap: 1rem;
            }
            #interactive-map {
                height: 400px;
            }
            .stats-grid {
                grid-template-columns: 1fr;
            }
            .map-card {
                position: relative;
                margin-bottom: 1rem;
            }
            #interactive-map {
                margin-bottom: 0;
            }
            .leaflet-top.leaflet-right {
                display: none !important;
            }
            .legend-dropdown-container {
                display: block;
            }
            .stats-section {
                margin-top: 2rem;
            }
        }
        @media (max-width: 480px) {
            body {
                padding: 0.5rem;
            }
            .container {
                padding: 0.75rem;
            }
            h1 {
                font-size: 1.5rem;
            }
            .subtitle {
                font-size: 0.85rem;
            }
            #interactive-map {
                height: 300px;
            }
            .stat-value {
                font-size: 1.5rem;
            }
            .legend-dropdown-items {
                grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)) !important;
            }
            .legend-dropdown-label {
                font-size: 0.7rem !important;
            }
            .legend-dropdown-color {
                width: 16px !important;
                height: 16px !important;
            }
            .legend-header {
                font-size: 0.8rem !important;
                margin-bottom: 0.4rem !important;
            }
            .legend-reset-btn {
                font-size: 0.7rem !important;
                padding: 0.4rem !important;
                margin-bottom: 0.25rem !important;
            }
            .legend-item {
                padding: 0.25rem !important;
                margin-bottom: 0 !important;
                gap: 0.4rem !important;
            }
            .legend-color {
                width: 14px !important;
                height: 14px !important;
                min-width: 14px !important;
                min-height: 14px !important;
            }
            .legend-label {
                font-size: 0.6rem !important;
            }
            .table-wrapper {
                max-height: 300px;
            }
            table {
                font-size: 0.8rem;
            }
            table th, table td {
                padding: 0.5rem;
            }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
            #interactive-map {
                height: 500px;
            }
            .leaflet-control-legend {
                max-width: 260px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Change Analysis Report</h1>
        <p class="subtitle">Generated on ${new Date().toLocaleString()}</p>
        
        <div class="maps-section" style="grid-template-columns: 1fr;">
            <div class="map-card">
                <h3>Change Analysis - Interactive Map</h3>
                <div id="interactive-map"></div>
                <p style="margin-top: 0.5rem; color: #94a3b8; font-size: 0.9rem;">Attribute: ${state.selectedAttribute || 'Not selected'}</p>
            </div>
        </div>
        
        <div class="legend-dropdown-container" id="legend-dropdown-container">
            <button class="legend-dropdown-toggle" id="legend-dropdown-toggle">
                <span>Legend</span>
                <span class="legend-dropdown-arrow">▼</span>
            </button>
            <div class="legend-dropdown-content" id="legend-dropdown-content" style="display: none;">
                <div class="legend-dropdown-header">Legend (Click to Highlight)</div>
                <button class="legend-reset-btn-dropdown" id="legend-reset-btn-dropdown">View All</button>
                <div class="legend-dropdown-items" id="legend-dropdown-items"></div>
            </div>
        </div>

        <div class="stats-section">
            <h2 style="margin-bottom: 1rem;">Analysis Summary</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <h4>Overall Change</h4>
                    <div class="stat-value">${results.changePercentage.toFixed(2)}%</div>
                    <div class="stat-label">Area Changed</div>
                </div>
                <div class="stat-card">
                    <h4>Total Area</h4>
                    <div class="stat-value">${totalAreaHa.toFixed(2)} ha</div>
                    <div class="stat-label">Analyzed Area</div>
                </div>
                <div class="stat-card">
                    <h4>Changed Area</h4>
                    <div class="stat-value">${changedAreaHa.toFixed(2)} ha</div>
                    <div class="stat-label">${results.changePercentage.toFixed(2)}% of total</div>
                </div>
                <div class="stat-card">
                    <h4>Unchanged Area</h4>
                    <div class="stat-value">${sameAreaHa.toFixed(2)} ha</div>
                    <div class="stat-label">${(100 - results.changePercentage).toFixed(2)}% of total</div>
                </div>
            </div>
        </div>

        ${topChangesHTML ? `<div class="stats-section">${topChangesHTML}</div>` : ''}

        <div class="footer">
            <p>Generated by GeoDrift Impact Analysis Tool</p>
        </div>
    </div>
    <script>
        const changeGeoJSON = ${geoJSONString};
        const transitionColorMap = ${JSON.stringify(transitionColorMap)};
        const legendData = ${legendDataString};
        const UNCHANGED_KEY = '__UNCHANGED__';
        const VIEW_ALL_KEY = '__VIEW_ALL__';
        
        let map;
        let geoJsonLayer;
        let selectedKey = null;
        
        function getTransitionKey(feature) {
            if (!feature || !feature.properties) return null;
            if (feature.properties.status !== 'changed') {
                return UNCHANGED_KEY;
            }
            return feature.properties.before_value + ' → ' + feature.properties.after_value;
        }
        
        function getChangeFeatureStyle(feature) {
            if (!feature || !feature.properties) return {};
            
            if (feature.properties.status !== 'changed') {
                return {
                    color: '#10b981',
                    weight: 1,
                    fillColor: '#10b981',
                    fillOpacity: 0.3,
                    opacity: 1
                };
            }
            
            const transition = getTransitionKey(feature);
            const color = transitionColorMap[transition] || '#f59e0b';
            return {
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.7,
                opacity: 1
            };
        }
        
        function getFeatureStyle(feature, highlightKey) {
            if (!feature || !feature.properties) return {};
            
            const isUnchanged = feature.properties.status !== 'changed';
            const transitionKey = getTransitionKey(feature);
            
            // If View All is selected, show all features normally (default styles)
            if (!highlightKey || highlightKey === VIEW_ALL_KEY) {
                return getChangeFeatureStyle(feature);
            }
            
            // Check if this feature matches the selected key
            const matches = transitionKey === highlightKey;
            
            if (isUnchanged) {
                return {
                    color: '#10b981',
                    weight: matches ? 3 : 1,
                    fillColor: '#10b981',
                    fillOpacity: matches ? 0.6 : 0.05,
                    opacity: matches ? 1 : 0.2
                };
            }
            
            const color = transitionColorMap[transitionKey] || '#f59e0b';
            return {
                color: color,
                weight: matches ? 3 : 1,
                fillColor: color,
                fillOpacity: matches ? 0.9 : 0.05,
                opacity: matches ? 1 : 0.2
            };
        }
        
        function highlightFeatures(key) {
            if (!geoJsonLayer) return;
            
            geoJsonLayer.eachLayer(function(layer) {
                const feature = layer.feature;
                const baseStyle = getChangeFeatureStyle(feature);
                const transitionKey = getTransitionKey(feature);
                const matches = transitionKey === key;
                
                layer.setStyle({
                    ...baseStyle,
                    opacity: matches ? 1 : 0.2,
                    fillOpacity: matches ? Math.min(baseStyle.fillOpacity + 0.2, 1) : 0.05,
                    weight: matches ? baseStyle.weight + 1 : 1
                });
                
                // Bring matching features to front
                if (matches && layer.bringToFront) {
                    layer.bringToFront();
                }
            });
        }
        
        function resetChangeStyles() {
            if (!geoJsonLayer) return;
            selectedKey = null;
            geoJsonLayer.eachLayer(function(layer) {
                const feature = layer.feature;
                if (!feature || !feature.properties) return;
                
                const isUnchanged = feature.properties.status !== 'changed';
                
                if (isUnchanged) {
                    layer.setStyle({
                        color: '#10b981',
                        weight: 1,
                        fillColor: '#10b981',
                        fillOpacity: 0.3,
                        opacity: 1
                    });
                } else {
                    const transition = getTransitionKey(feature);
                    const color = transitionColorMap[transition] || '#f59e0b';
                    layer.setStyle({
                        color: color,
                        weight: 2,
                        fillColor: color,
                        fillOpacity: 0.7,
                        opacity: 1
                    });
                }
            });
        }
        
        // Custom Legend Control
        const LegendControl = L.Control.extend({
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'leaflet-control-legend');
                const header = L.DomUtil.create('div', 'legend-header');
                header.textContent = 'Legend (Click to Highlight)';
                container.appendChild(header);
                
                // Add Force Reset button
                const resetBtn = L.DomUtil.create('button', 'legend-reset-btn');
                resetBtn.innerHTML = ' View All';
                resetBtn.style.cssText = 'width: 100%; padding: 0.75rem; margin-bottom: 0.75rem; background: rgba(129, 140, 248, 0.2); border: 1px solid #818cf8; border-radius: 8px; color: #818cf8; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: all 0.2s;';
                resetBtn.addEventListener('mouseenter', function() {
                    this.style.background = 'rgba(129, 140, 248, 0.3)';
                });
                resetBtn.addEventListener('mouseleave', function() {
                    this.style.background = 'rgba(129, 140, 248, 0.2)';
                });
                resetBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Reset all features to default visibility
                    if (geoJsonLayer) {
                        geoJsonLayer.eachLayer(function(layer) {
                            const feature = layer.feature;
                            if (!feature || !feature.properties) return;
                            
                            const isUnchanged = feature.properties.status !== 'changed';
                            
                            if (isUnchanged) {
                                layer.setStyle({
                                    color: '#10b981',
                                    weight: 1,
                                    fillColor: '#10b981',
                                    fillOpacity: 0.3,
                                    opacity: 1
                                });
                            } else {
                                const transition = getTransitionKey(feature);
                                const color = transitionColorMap[transition] || '#f59e0b';
                                layer.setStyle({
                                    color: color,
                                    weight: 2,
                                    fillColor: color,
                                    fillOpacity: 0.7,
                                    opacity: 1
                                });
                            }
                        });
                    }
                    // Remove active state from all legend items
                    container.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
                    selectedKey = null;
                });
                container.appendChild(resetBtn);
                
                const separator = L.DomUtil.create('div', 'legend-separator');
                separator.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.2); margin: 0.5rem 0;';
                container.appendChild(separator);
                
                legendData.forEach((item, index) => {
                    if (index > 0) {
                        const sep = L.DomUtil.create('div', 'legend-separator');
                        sep.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.2); margin: 0.5rem 0;';
                        container.appendChild(sep);
                    }
                    
                    const itemDiv = L.DomUtil.create('div', 'legend-item');
                    itemDiv.dataset.key = item.key;
                    itemDiv.style.display = 'flex';
                    itemDiv.style.alignItems = 'center';
                    itemDiv.style.gap = '0.75rem';
                    itemDiv.style.padding = '0.5rem';
                    itemDiv.style.marginBottom = '0.5rem';
                    itemDiv.style.borderRadius = '8px';
                    itemDiv.style.cursor = 'pointer';
                    itemDiv.style.transition = 'all 0.2s';
                    itemDiv.style.border = '1px solid transparent';
                    itemDiv.style.userSelect = 'none';
                    itemDiv.style.listStyle = 'none';
                    itemDiv.style.webkitAppearance = 'none';
                    itemDiv.style.mozAppearance = 'none';
                    itemDiv.style.appearance = 'none';
                    
                    const colorDiv = L.DomUtil.create('div', 'legend-color');
                    colorDiv.style.width = '24px';
                    colorDiv.style.height = '24px';
                    colorDiv.style.borderRadius = '4px';
                    colorDiv.style.border = '1px solid rgba(255, 255, 255, 0.3)';
                    colorDiv.style.flexShrink = '0';
                    colorDiv.style.display = 'block';
                    colorDiv.style.webkitAppearance = 'none';
                    colorDiv.style.mozAppearance = 'none';
                    colorDiv.style.appearance = 'none';
                    
                    if (item.isDashed) {
                        colorDiv.style.background = 'transparent';
                        colorDiv.style.border = '2px dashed rgba(255,255,255,0.3)';
                    } else {
                        colorDiv.style.backgroundColor = item.color;
                    }
                    
                    const labelDiv = L.DomUtil.create('div', 'legend-label');
                    labelDiv.textContent = item.label;
                    labelDiv.style.fontSize = '0.85rem';
                    labelDiv.style.wordBreak = 'break-word';
                    labelDiv.style.color = '#f8fafc';
                    labelDiv.style.flex = '1';
                    
                    itemDiv.appendChild(colorDiv);
                    itemDiv.appendChild(labelDiv);
                    
                    // Add click handler
                    itemDiv.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const key = this.dataset.key;
                        
                        // Update active state
                        container.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
                        this.classList.add('active');
                        
                        selectedKey = key;
                        highlightFeatures(key);
                    });
                    
                    container.appendChild(itemDiv);
                });
                
                L.DomEvent.disableClickPropagation(container);
                return container;
            }
        });
        
        // Initialize map with light basemap
        map = L.map('interactive-map').setView([20, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(map);
        
        // Add zoom control
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        
        // Add area scale control
        // Add scale control to report map
        L.control.scale({ 
            position: 'bottomleft',
            imperial: false,
            metric: true
        }).addTo(map);
        
        // Add north/reset button
        const NorthControl = L.Control.extend({
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'leaflet-control-north');
                const button = L.DomUtil.create('button', 'north-control-btn');
                button.innerHTML = '🧭';
                button.style.cssText = 'width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255, 255, 255, 0.2); color: #f8fafc; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;';
                button.addEventListener('mouseenter', function() {
                    this.style.background = 'rgba(129, 140, 248, 0.3)';
                });
                button.addEventListener('mouseleave', function() {
                    this.style.background = 'rgba(30, 41, 59, 0.9)';
                });
                button.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (changeGeoJSON.features && changeGeoJSON.features.length > 0 && geoJsonLayer) {
                        map.fitBounds(geoJsonLayer.getBounds());
                    } else {
                        map.setView([20, 0], 2);
                    }
                });
                container.appendChild(button);
                L.DomEvent.disableClickPropagation(container);
                return container;
            }
        });
        new NorthControl({ position: 'topleft' }).addTo(map);
        
        // Add GeoJSON layer with default styles
        geoJsonLayer = L.geoJSON(changeGeoJSON, {
            style: (feature) => getChangeFeatureStyle(feature),
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                let popupContent = '<div style="font-family: Outfit, sans-serif; color: #000;">';
                popupContent += '<strong>Status:</strong> ' + props.status + '<br>';
                popupContent += '<strong>Before:</strong> ' + props.before_value + '<br>';
                popupContent += '<strong>After:</strong> ' + props.after_value + '<br>';
                popupContent += '<strong>Area:</strong> ' + (props.area_m2 / 10000).toFixed(2) + ' ha<br>';
                popupContent += '</div>';
                layer.bindPopup(popupContent);
            }
        }).addTo(map);
        
        // Fit bounds
        if (changeGeoJSON.features && changeGeoJSON.features.length > 0) {
            map.fitBounds(geoJsonLayer.getBounds());
        }
        
        // Add legend control
        const legendControl = new LegendControl({ position: 'topright' });
        legendControl.addTo(map);
        
        // Setup dropdown legend for mobile
        const dropdownToggle = document.getElementById('legend-dropdown-toggle');
        const dropdownContent = document.getElementById('legend-dropdown-content');
        const dropdownItems = document.getElementById('legend-dropdown-items');
        const resetBtnDropdown = document.getElementById('legend-reset-btn-dropdown');
        
        if (dropdownToggle && dropdownContent && dropdownItems) {
            // Toggle dropdown
            dropdownToggle.addEventListener('click', function() {
                const isOpen = dropdownContent.style.display !== 'none';
                dropdownContent.style.display = isOpen ? 'none' : 'block';
                dropdownToggle.classList.toggle('active', !isOpen);
            });
            
            // Populate dropdown items
            legendData.forEach((item) => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'legend-dropdown-item';
                itemDiv.dataset.key = item.key;
                
                const colorDiv = document.createElement('div');
                colorDiv.className = 'legend-dropdown-color';
                if (item.isDashed) {
                    colorDiv.style.background = 'transparent';
                    colorDiv.style.border = '2px dashed rgba(255,255,255,0.3)';
                } else {
                    colorDiv.style.backgroundColor = item.color;
                }
                
                const labelDiv = document.createElement('div');
                labelDiv.className = 'legend-dropdown-label';
                labelDiv.textContent = item.label;
                
                itemDiv.appendChild(colorDiv);
                itemDiv.appendChild(labelDiv);
                
                // Add click handler
                itemDiv.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const key = this.dataset.key;
                    
                    // Update active state
                    dropdownItems.querySelectorAll('.legend-dropdown-item').forEach(i => i.classList.remove('active'));
                    this.classList.add('active');
                    
                    selectedKey = key;
                    highlightFeatures(key);
                });
                
                dropdownItems.appendChild(itemDiv);
            });
            
            // Reset button handler
            if (resetBtnDropdown) {
                resetBtnDropdown.addEventListener('click', function(e) {
                    e.stopPropagation();
                    resetChangeStyles();
                    dropdownItems.querySelectorAll('.legend-dropdown-item').forEach(i => i.classList.remove('active'));
                    selectedKey = null;
                });
            }
        }
        
        // Set View All as active initially and ensure all features are visible
        setTimeout(function() {
            const viewAllItem = document.querySelector('.legend-item[data-key="__VIEW_ALL__"]');
            if (viewAllItem) {
                viewAllItem.classList.add('active');
            }
            // Ensure all features are at default visibility
            resetChangeStyles();
        }, 300);
        
        // Handle window resize for mobile
        let resizeTimer;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() {
                map.invalidateSize();
                if (changeGeoJSON.features && changeGeoJSON.features.length > 0) {
                    map.fitBounds(geoJsonLayer.getBounds());
                }
            }, 250);
        });
        
        // Initial resize check for mobile
        setTimeout(function() {
            map.invalidateSize();
        }, 100);
    </script>
</body>
</html>`;
    }

    if (downloadReportBtn) {
        downloadReportBtn.addEventListener('click', downloadReportWebpage);
    }

    document.getElementById('stats-close').addEventListener('click', () => {
        setStatsPanelVisibility(false);
    });

    // --- Map Sync ---
    function syncMaps(sourceMap, targetMap) {
        if (!state.syncEnabled) return;
        const center = sourceMap.getCenter();
        const zoom = sourceMap.getZoom();
        const targetCenter = targetMap.getCenter();
        const targetZoom = targetMap.getZoom();

        if (Math.abs(center.lat - targetCenter.lat) > 0.0001 ||
            Math.abs(center.lng - targetCenter.lng) > 0.0001 ||
            zoom !== targetZoom) {
            targetMap.setView(center, zoom, { animate: false });
        }
    }

    mapBefore.on('move', () => syncMaps(mapBefore, mapAfter));
    mapAfter.on('move', () => syncMaps(mapAfter, mapBefore));

    // North/Reset button
    const northBtn = document.getElementById('north-btn');
    if (northBtn) {
        northBtn.addEventListener('click', () => {
            // Reset all maps to north (no rotation) and recenter if there are layers
            const maps = [mapBefore, mapAfter];
            if (mapChange) maps.push(mapChange);
            
            maps.forEach(map => {
                if (map) {
                    // If there's a layer, fit to bounds, otherwise just reset view
                    let hasLayer = false;
                    if (state.before.layer && map === mapBefore) {
                        map.fitBounds(state.before.layer.getBounds());
                        hasLayer = true;
                    } else if (state.after.layer && map === mapAfter) {
                        map.fitBounds(state.after.layer.getBounds());
                        hasLayer = true;
                    } else if (state.change.layer && map === mapChange) {
                        map.fitBounds(state.change.layer.getBounds());
                        hasLayer = true;
                    }
                    
                    if (!hasLayer) {
                        map.setView([20, 0], 2);
                    }
                }
            });
        });
    }

    document.getElementById('sync-maps-btn').addEventListener('click', (e) => {
        state.syncEnabled = !state.syncEnabled;
        e.currentTarget.classList.toggle('active');
    });

    document.getElementById('attribute-select').addEventListener('change', (e) => {
        const attribute = e.target.value;
        if (attribute) {
            applySymbology(attribute);
        }
    });

    document.getElementById('process-btn').addEventListener('click', analyzeChanges);

    // --- File Handling ---
    const dropZones = {
        before: document.getElementById('drop-zone-before'),
        after: document.getElementById('drop-zone-after')
    };

    ['before', 'after'].forEach(key => {
        const zone = dropZones[key];
        const input = zone.querySelector('input');

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-active');
        });

        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-active');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-active');
            handleFiles(e.dataTransfer.files, key);
        });

        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => handleFiles(e.target.files, key));
    });

    async function handleFiles(fileList, key) {
        if (fileList.length === 0) return;

        const file = fileList[0];
        if (!file.name.endsWith('.zip')) {
            alert('Please upload a .zip file containing the shapefile components.');
            return;
        }

        const zone = dropZones[key];
        const originalContent = zone.innerHTML;
        zone.innerHTML = '<div class="content"><span class="material-icons-round spin" style="font-size: 3rem;">sync</span><p>Processing...</p></div>';

        try {
            const buffer = await file.arrayBuffer();
            const geojson = await shp(buffer);

            state[key].geojson = geojson;
            state[key].file = file;

            // Reset analysis results when new files are uploaded
            state.changeResults = null;
            if (downloadReportBtn) {
                downloadReportBtn.disabled = true;
            }
            if (statsToggleBtn) {
                statsToggleBtn.disabled = true;
                statsToggleBtn.classList.remove('active');
            }

            if (state[key].layer) {
                state[key].map.removeLayer(state[key].layer);
            }

            const layer = L.geoJSON(geojson, {
                style: {
                    color: key === 'before' ? '#6366f1' : '#a855f7',
                    weight: 2,
                    fillOpacity: 0.3
                }
            }).addTo(state[key].map);

            state[key].layer = layer;
            state[key].map.fitBounds(layer.getBounds());
            zone.classList.add('hidden');

            setTimeout(() => zone.innerHTML = originalContent, 500);

            if (state.before.geojson && state.after.geojson) {
                populateAttributeDropdown(state.before.geojson);
            }

            checkReady();

        } catch (error) {
            console.error(error);
            alert('Error parsing shapefile. Ensure the .zip contains .shp, .shx, and .dbf files.');
            zone.innerHTML = originalContent;
        }
    }

    function checkReady() {
        const btn = document.getElementById('process-btn');
        if (state.before.file && state.after.file) {
            btn.disabled = false;
        }
    }
});
