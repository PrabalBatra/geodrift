document.addEventListener('DOMContentLoaded', () => {
    // --- Map Initialization ---
    const mapOptions = { zoomControl: false, attributionControl: true };
    const mapBefore = L.map('map-before', mapOptions).setView([20, 0], 2);
    const mapAfter = L.map('map-after', mapOptions).setView([20, 0], 2);
    let mapChange = null; // Will be initialized when needed

    const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const attribution = '&copy; OpenStreetMap &copy; CARTO';

    L.tileLayer(tileUrl, { attribution }).addTo(mapBefore);
    L.tileLayer(tileUrl, { attribution }).addTo(mapAfter);
    L.control.zoom({ position: 'bottomright' }).addTo(mapBefore);
    L.control.zoom({ position: 'bottomright' }).addTo(mapAfter);

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
        }
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
            L.tileLayer(tileUrl, { attribution }).addTo(mapChange);
            L.control.zoom({ position: 'bottomright' }).addTo(mapChange);
            state.change.map = mapChange;
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
    </style>
</head>
<body>
    <div class="container">
        <h1>Change Analysis Report</h1>
        <p class="subtitle">Generated on ${new Date().toLocaleString()}</p>
        
        <div class="maps-section" style="grid-template-columns: 1fr;">
            <div class="map-card">
                <h3>Change Analysis</h3>
                ${changeImage ? `<img src="${changeImage}" alt="Change Map">` : '<p style="color: #94a3b8;">Map image not available</p>'}
                <p style="margin-top: 0.5rem; color: #94a3b8; font-size: 0.9rem;">Attribute: ${state.selectedAttribute || 'Not selected'}</p>
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
