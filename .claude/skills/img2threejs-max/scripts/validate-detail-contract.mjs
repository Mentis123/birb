#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

// Keep in sync with REPRESENTATION in estimate-likeness-effort.mjs.
const REPRESENTATIONS = new Set([
    'sampled-field',
    'explicit-geometry',
    'explicit-mesh',
    'parametric',
    'primitive-composition',
    'hybrid',
    'texture',
    'texture-relief',
    'authored-asset',
]);
// Declared px widths must stay within these ratios of what the declared
// camera actually projects for the declared physical bounds. Foreshortening
// legitimately shrinks the projection, so the lower bound is loose; a declared
// width far ABOVE the projection means the scene's width was copied into a
// detail's view.
const PROJECTION_RATIO_MIN = 0.3;
const PROJECTION_RATIO_MAX = 2;
const DIAGNOSTIC_MIN_WIDTH_PX = 150;
const PURPOSES = new Set(['diagnostic', 'delivery']);
const ACCEPTANCE = new Set(['pending', 'pass', 'fail']);

function usage() {
    console.log('usage: validate-detail-contract.mjs <contract.json> [--closeout]');
}

function isPositiveNumber(value) {
    return Number.isFinite(value) && value > 0;
}

function isNumberArray(value, length, positive = false) {
    return Array.isArray(value)
        && value.length === length
        && value.every((item) => Number.isFinite(item) && (!positive || item > 0));
}

function requiredString(detail, key, errors) {
    if (typeof detail[key] !== 'string' || detail[key].trim() === '') {
        errors.push((detail.id || '<unnamed>') + ': ' + key + ' must be a non-empty string');
    }
}

function classifyRatio(ratio) {
    if (ratio < 3) return 'unsafe';
    if (ratio < 6) return 'fragile';
    return 'stable';
}

/**
 * Pixels one model unit projects to at the view's target distance. Returns
 * null when any input needed for the projection is missing or invalid.
 */
function pxPerModelUnit(view) {
    const camera = view?.camera;
    if (!camera || !isNumberArray(view.viewport, 2, true)) return null;
    if (!isPositiveNumber(camera.fov) || camera.fov >= 180) return null;
    if (!isPositiveNumber(camera.distance)) return null;
    return view.viewport[1] / (2 * camera.distance * Math.tan(camera.fov * Math.PI / 360));
}

function checkProjectedScale(detail, id, metersPerUnit, warnings) {
    if (!isNumberArray(detail.physicalBoundsMm, 3, true)) return;
    const widthUnits = Math.max(...detail.physicalBoundsMm) / 1000 / metersPerUnit;
    for (const view of detail.integratedViews ?? []) {
        const scale = pxPerModelUnit(view);
        if (scale === null || !isPositiveNumber(view?.objectWidthPx)) continue;
        const expected = widthUnits * scale;
        const ratio = view.objectWidthPx / expected;
        const label = id + ': view ' + view.id;
        if (ratio > PROJECTION_RATIO_MAX || ratio < PROJECTION_RATIO_MIN) {
            warnings.push(label + ' declares objectWidthPx=' + view.objectWidthPx
                + ' but the declared camera projects the declared bounds at ~'
                + expected.toFixed(0) + ' px (' + ratio.toFixed(2)
                + 'x); measure the object, do not copy the scene width');
        }
        if (view.purpose === 'diagnostic' && expected < DIAGNOSTIC_MIN_WIDTH_PX) {
            warnings.push(label + ' can project this object at only ~'
                + expected.toFixed(0) + ' px; the ' + DIAGNOSTIC_MIN_WIDTH_PX
                + ' px diagnostic floor is unreachable from this camera - move it closer');
        }
    }
}

function validateView(detailId, view, index, errors) {
    const label = detailId + ': view ' + (view?.id || index);
    if (!view || typeof view !== 'object') {
        errors.push(label + ' must be an object');
        return;
    }
    if (typeof view.id !== 'string' || view.id.trim() === '') {
        errors.push(label + ' needs a non-empty id');
    }
    if (!PURPOSES.has(view.purpose)) {
        errors.push(label + ' purpose must be diagnostic or delivery');
    }
    if (!isNumberArray(view.viewport, 2, true)) {
        errors.push(label + ' viewport must contain two positive numbers');
    }
    if (!isPositiveNumber(view.dpr)) {
        errors.push(label + ' dpr must be positive');
    }
    const camera = view.camera;
    if (!camera || typeof camera !== 'object') {
        errors.push(label + ' camera is required');
    } else {
        if (!isPositiveNumber(camera.fov) || camera.fov >= 180) {
            errors.push(label + ' camera.fov must be between 0 and 180');
        }
        if (!isNumberArray(camera.target, 3)) {
            errors.push(label + ' camera.target must contain three numbers');
        }
        for (const key of ['yaw', 'pitch']) {
            if (!Number.isFinite(camera[key])) {
                errors.push(label + ' camera.' + key + ' must be a number');
            }
        }
        if (!isPositiveNumber(camera.distance)) {
            errors.push(label + ' camera.distance must be positive');
        }
    }
    if (!isPositiveNumber(view.objectWidthPx)) {
        errors.push(label + ' objectWidthPx must be positive');
    }
    if (!isPositiveNumber(view.smallestSignalPx)) {
        errors.push(label + ' smallestSignalPx must be positive');
    }
}

function validateDetail(detail, closeout, ids, errors, warnings, rows, metersPerUnit) {
    if (!detail || typeof detail !== 'object') {
        errors.push('Each details entry must be an object');
        return;
    }

    requiredString(detail, 'id', errors);
    const id = typeof detail.id === 'string' && detail.id.trim()
        ? detail.id.trim()
        : '<unnamed>';
    if (ids.has(id)) errors.push(id + ': duplicate detail id');
    ids.add(id);

    for (const key of [
        'semanticRead',
        'referenceAsset',
        'occlusionContract',
        'isolationProbe',
    ]) requiredString(detail, key, errors);

    if (!isNumberArray(detail.referenceCrop, 4)) {
        errors.push(id + ': referenceCrop must be [x, y, width, height]');
    } else if (detail.referenceCrop[0] < 0
        || detail.referenceCrop[1] < 0
        || detail.referenceCrop[2] <= 0
        || detail.referenceCrop[3] <= 0) {
        errors.push(id + ': referenceCrop origin must be non-negative and size positive');
    }
    if (!Array.isArray(detail.referenceLandmarks)
        || detail.referenceLandmarks.length < 3
        || detail.referenceLandmarks.length > 8
        || detail.referenceLandmarks.some((item) => typeof item !== 'string' || !item.trim())) {
        errors.push(id + ': referenceLandmarks must contain 3-8 non-empty strings');
    }
    if (!isNumberArray(detail.physicalBoundsMm, 3, true)) {
        errors.push(id + ': physicalBoundsMm must contain three positive numbers');
    }
    if (!isPositiveNumber(detail.smallestSignalMm)) {
        errors.push(id + ': smallestSignalMm must be positive');
    }
    if (!REPRESENTATIONS.has(detail.representation)) {
        errors.push(id + ': unsupported representation ' + detail.representation);
    }

    let ratio = null;
    let ratioClass = 'n/a';
    if (detail.representation === 'sampled-field' || detail.representation === 'hybrid') {
        if (typeof detail.signalProvenance !== 'string' || !detail.signalProvenance.trim()) {
            warnings.push(id + ': no signalProvenance for smallestSignalMm; record the'
                + ' reference crop and px-to-mm conversion it was measured from, and never'
                + ' derive the signal from the voxel size to clear the sampling gate');
        }
        if (!isPositiveNumber(detail.voxelMm)) {
            errors.push(id + ': voxelMm is required for ' + detail.representation);
        } else if (isPositiveNumber(detail.smallestSignalMm)) {
            ratio = detail.smallestSignalMm / detail.voxelMm;
            ratioClass = classifyRatio(ratio);
            if (ratioClass === 'unsafe') {
                errors.push(
                    id + ': sampling ratio ' + ratio.toFixed(2)
                    + ' is unsafe; use explicit geometry or increase resolution'
                );
            } else if (ratioClass === 'fragile') {
                warnings.push(
                    id + ': sampling ratio ' + ratio.toFixed(2)
                    + ' is fragile and needs a normal-material close view'
                );
            }
        }
    }

    const views = detail.integratedViews;
    if (!Array.isArray(views) || views.length === 0) {
        errors.push(id + ': integratedViews must contain at least one view');
    } else {
        views.forEach((view, index) => validateView(id, view, index, errors));
        const diagnostic = views.find((view) => view?.purpose === 'diagnostic');
        if (!diagnostic) {
            errors.push(id + ': at least one diagnostic view is required');
        } else {
            if (diagnostic.objectWidthPx < 150) {
                errors.push(id + ': diagnostic objectWidthPx must be at least 150');
            }
            if (diagnostic.smallestSignalPx < 8) {
                errors.push(id + ': diagnostic smallestSignalPx must be at least 8');
            }
        }
        if (closeout && !views.some((view) => view?.purpose === 'delivery')) {
            errors.push(id + ': closeout requires at least one delivery view');
        }
        checkProjectedScale(detail, id, metersPerUnit, warnings);
    }

    for (const key of ['meshAssertions', 'renderAssertions']) {
        if (!Array.isArray(detail[key])
            || detail[key].length === 0
            || detail[key].some((item) => typeof item !== 'string' || !item.trim())) {
            errors.push(id + ': ' + key + ' must contain non-empty strings');
        }
    }

    const acceptance = detail.humanAcceptance;
    if (!acceptance || typeof acceptance !== 'object'
        || !ACCEPTANCE.has(acceptance.status)
        || !Array.isArray(acceptance.unresolved)
        || acceptance.unresolved.some((item) => typeof item !== 'string')) {
        errors.push(id + ': humanAcceptance needs a valid status and unresolved[]');
    } else if (closeout) {
        if (acceptance.status !== 'pass') {
            errors.push(id + ': closeout requires humanAcceptance.status=pass');
        }
        if (acceptance.unresolved.length > 0) {
            errors.push(id + ': closeout has unresolved visual differences');
        }
    }

    rows.push({ id, representation: detail.representation, ratio, ratioClass });
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
}
const closeout = args.includes('--closeout');
const fileArg = args.find((arg) => !arg.startsWith('-'));
if (!fileArg) {
    usage();
    process.exit(2);
}

const contractPath = path.resolve(fileArg);
let contract;
try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
} catch (error) {
    console.error('Unable to read ' + contractPath + ': ' + error.message);
    process.exit(2);
}

const errors = [];
const warnings = [];
const rows = [];
if (contract?.version !== 1) errors.push('version must be 1');
if (typeof contract?.project !== 'string' || !contract.project.trim()) {
    errors.push('project must be a non-empty string');
}
let metersPerUnit = 1;
if (contract?.modelMetersPerUnit !== undefined) {
    if (!isPositiveNumber(contract.modelMetersPerUnit)) {
        errors.push('modelMetersPerUnit must be a positive number when present');
    } else {
        metersPerUnit = contract.modelMetersPerUnit;
    }
}
if (!Array.isArray(contract?.details) || contract.details.length === 0) {
    errors.push('details must contain at least one entry');
} else {
    const ids = new Set();
    contract.details.forEach((detail) => {
        validateDetail(detail, closeout, ids, errors, warnings, rows, metersPerUnit);
    });
}

console.log('Detail contract: ' + contractPath);
console.log('Mode: ' + (closeout ? 'closeout' : 'planning'));
for (const row of rows) {
    const ratio = row.ratio === null ? 'n/a' : row.ratio.toFixed(2);
    console.log('- ' + row.id + ': ' + row.representation + ', rho=' + ratio + ', ' + row.ratioClass);
}
for (const warning of warnings) console.warn('WARN: ' + warning);
for (const error of errors) console.error('ERROR: ' + error);

if (errors.length > 0) {
    console.error('FAIL: ' + errors.length + ' error(s), ' + warnings.length + ' warning(s)');
    process.exit(1);
}
console.log('PASS: ' + rows.length + ' detail(s), ' + warnings.length + ' warning(s)');
