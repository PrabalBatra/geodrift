# 🛰️ Change Detection for Vector Layers

A lightweight and efficient workflow for detecting spatial and attribute changes between two vector datasets.

This project compares a **baseline vector layer** with an **updated vector layer** and identifies features that were added, removed, modified, or unchanged.

---

## ✨ Features

- Detect newly added features
- Detect deleted features
- Detect geometry changes
- Detect attribute changes
- Compare polygon, line, or point layers
- Export detected changes as separate vector layers
- Useful for GIS updates, land-use monitoring, cadastral checks, and infrastructure tracking

---

## 📌 Use Case

Change detection is useful when you have two versions of a vector dataset, for example:

- Old building footprints vs updated building footprints
- Previous road network vs new road network
- Historical land parcels vs current land parcels
- Old administrative boundaries vs revised boundaries

---

## 📂 Input Data

The tool requires two vector layers:

| Layer | Description |
|---|---|
| Baseline Layer | Older or reference vector dataset |
| Updated Layer | Newer vector dataset to compare against |

Supported formats may include:

- GeoPackage `.gpkg`
- Shapefile `.shp`
- GeoJSON `.geojson`
- Any vector format supported by your GIS environment

---

## 🔍 Change Categories

The output classifies features into the following categories:

| Change Type | Meaning |
|---|---|
| Added | Feature exists only in the updated layer |
| Removed | Feature exists only in the baseline layer |
| Geometry Changed | Feature exists in both layers but geometry is different |
| Attribute Changed | Feature exists in both layers but attributes are different |
| Unchanged | Feature exists in both layers with no detected change |

---

## ⚙️ Workflow

1. Load the baseline vector layer
2. Load the updated vector layer
3. Match features using a unique ID field
4. Compare geometries
5. Compare selected attributes
6. Generate change detection outputs
7. Review results in GIS software

---

## 🧩 Required Fields

Both layers should contain a common unique identifier field.

Example:

```text
feature_id
parcel_id
building_id
road_id
