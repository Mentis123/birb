#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const LEVELS = ['absent/wrong', 'structural', 'semantic', 'reference-faithful', 'high-fidelity'];
const STEP = { 1: 0.75, 2: 1, 3: 1.8, 4: 3.6 };
const CATEGORY = {
    structure: 0.8, silhouette: 1.1, body: 1.8, face: 2.8,
    'hand-foot': 2.3, hair: 1.6, 'semantic-detail': 1.8, surface: 1.5,
    'material-lighting': 0.9, camera: 0.8, interaction: 0.8, performance: 1,
};
const COMPLEXITY = { 1: 0.65, 2: 0.85, 3: 1, 4: 1.35, 5: 1.8 };
const REPRESENTATION = {
    parametric: 0.85, 'primitive-composition': 0.9,
    'explicit-geometry': 1, 'explicit-mesh': 1, texture: 1,
    'texture-relief': 1.05, 'authored-asset': 1.15,
    'sampled-field': 1.3, hybrid: 1.5,
    'scan-retopology': 1.55, 'sculpt-retopology': 1.75,
};
const REFERENCE = { excellent: 0.85, good: 1, partial: 1.35, poor: 1.8 };
const VISIBILITY = { clear: 1, partial: 1.25, 'mostly-hidden': 1.65 };
const CONTACT = { low: 1, medium: 1.2, high: 1.5 };
const TOPOLOGY = { low: 1, medium: 1.25, high: 1.6 };
const FALLBACK = {
    tokens: [10000, 40000], hours: [0.2, 1],
    audit: [3, 8], closeout: [2, 6],
};
const RANK = { low: 0, medium: 1, high: 2 };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = (value) => Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const range = (value) => Array.isArray(value) && value.length === 2
    && value.every(positive) && value[0] <= value[1];

function usage() {
    console.log('usage: estimate-likeness-effort.mjs <estimate.json> [--threshold <id-or-score>] [--json] [--strict]');
}

function parseArgs(args) {
    const result = { file: null, threshold: null, json: false, strict: false, help: false };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') result.help = true;
        else if (arg === '--json') result.json = true;
        else if (arg === '--strict') result.strict = true;
        else if (arg === '--threshold') result.threshold = args[++i] ?? null;
        else if (arg.startsWith('-')) throw new Error('Unknown option ' + arg);
        else if (!result.file) result.file = arg;
        else throw new Error('Unexpected argument ' + arg);
    }
    if (args.includes('--threshold') && result.threshold === null) {
        throw new Error('--threshold needs an id or score');
    }
    return result;
}

function quantile(values, q) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * q;
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - at) + sorted[hi] * (at - lo);
}

function sampleRange(values, fallback) {
    if (values.length >= 4) {
        return [Math.max(0.0001, quantile(values, 0.2) * 0.8),
            Math.max(0.0001, quantile(values, 0.8) * 1.25)];
    }
    if (values.length) {
        return [Math.max(0.0001, Math.min(...values) * 0.65),
            Math.max(0.0001, Math.max(...values) * 1.6)];
    }
    return fallback;
}

function confidence(count) {
    return count >= 12 ? 'high' : count >= 4 ? 'medium' : 'low';
}

function lowest(values) {
    return values.reduce((answer, value) => RANK[value] < RANK[answer] ? value : answer, 'high');
}

function targetLevel(feature, threshold) {
    return Math.max(
        threshold.defaultLevel,
        threshold.categoryMinimumLevels[feature.category] ?? threshold.defaultLevel,
        feature.critical ? threshold.criticalMinimumLevel : 0
    );
}

function weightedScore(features, getLevel) {
    const total = features.reduce((sum, feature) => sum + feature.weight, 0);
    return total ? 100 * features.reduce(
        (sum, feature) => sum + feature.weight * getLevel(feature) / 4, 0
    ) / total : 0;
}

function stepCost(from, to) {
    let result = 0;
    for (let level = from + 1; level <= to; level += 1) result += STEP[level];
    return result;
}

function featureCycles(feature, level, delivery) {
    if (level <= feature.currentLevel) return 0;
    const views = feature.acceptedViews ?? delivery.acceptedViews;
    const view = Math.min(1.75, 1 + 0.09 * (views - 1));
    const repeated = 1 + (feature.count - 1) * (1 - 0.75 * feature.reuseFraction);
    const difficulty = Math.pow(
        COMPLEXITY[feature.complexity]
        * REPRESENTATION[feature.representation]
        * REFERENCE[feature.referenceQuality]
        * VISIBILITY[feature.visibility]
        * CONTACT[feature.contactRisk]
        * TOPOLOGY[feature.topologyRisk],
        1 / 6
    );
    return (CATEGORY[feature.category] ?? 1.5)
        * stepCost(feature.currentLevel, level)
        * difficulty * view * repeated;
}

function formatAmount(value) {
    if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 1 : 2)
        .replace(/\.0+$/, '') + 'M';
    if (value >= 1000) return Math.round(value / 1000) + 'K';
    return Math.round(value).toString();
}

function formatDecimal(value) {
    return Number(value.toFixed(1)).toString();
}

let cli;
try {
    cli = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    usage();
    process.exit(2);
}
if (cli.help) {
    usage();
    process.exit(0);
}
if (!cli.file) {
    usage();
    process.exit(2);
}

const source = path.resolve(cli.file);
let plan;
try {
    plan = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch (error) {
    console.error('Unable to read ' + source + ': ' + error.message);
    process.exit(2);
}

const errors = [];
const warnings = [];
const need = (condition, message) => { if (!condition) errors.push(message); };
need(plan?.version === 1, 'version must be 1');
need(typeof plan?.project === 'string' && !!plan.project.trim(), 'project must be a non-empty string');
need(plan?.referenceSet && typeof plan.referenceSet === 'object', 'referenceSet must be an object');
need(plan?.delivery && typeof plan.delivery === 'object', 'delivery must be an object');
need(Array.isArray(plan?.features) && plan.features.length > 0, 'features must contain entries');
need(Array.isArray(plan?.thresholds) && plan.thresholds.length > 0, 'thresholds must contain entries');

if (plan?.referenceSet) {
    need(Number.isInteger(plan.referenceSet.viewCount) && plan.referenceSet.viewCount > 0,
        'referenceSet.viewCount must be positive');
    need(finite(plan.referenceSet.hiddenSurfaceFraction)
        && plan.referenceSet.hiddenSurfaceFraction >= 0
        && plan.referenceSet.hiddenSurfaceFraction <= 1,
    'referenceSet.hiddenSurfaceFraction must be between 0 and 1');
    need(typeof plan.referenceSet.conflictingViews === 'boolean',
        'referenceSet.conflictingViews must be boolean');
}
if (plan?.delivery) {
    need(Number.isInteger(plan.delivery.acceptedViews) && plan.delivery.acceptedViews > 0,
        'delivery.acceptedViews must be positive');
    for (const key of ['mobile', 'fullOrbit', 'performanceConstrained']) {
        need(typeof plan.delivery[key] === 'boolean', 'delivery.' + key + ' must be boolean');
    }
}

const featureIds = new Set();
for (const [index, feature] of (plan.features ?? []).entries()) {
    const id = feature?.id || 'feature-' + (index + 1);
    need(feature && typeof feature === 'object', id + ' must be an object');
    if (!feature || typeof feature !== 'object') continue;
    need(typeof feature.id === 'string' && !!feature.id.trim(), id + ': id is required');
    need(!featureIds.has(feature.id), id + ': duplicate id');
    featureIds.add(feature.id);
    for (const key of ['category', 'description', 'supportReason']) {
        need(typeof feature[key] === 'string' && !!feature[key].trim(), id + ': ' + key + ' is required');
    }
    need(Number.isInteger(feature.count) && feature.count > 0, id + ': count must be positive');
    need(finite(feature.reuseFraction) && feature.reuseFraction >= 0
        && feature.reuseFraction <= 1, id + ': reuseFraction must be 0..1');
    need(positive(feature.weight), id + ': weight must be positive');
    need(typeof feature.critical === 'boolean', id + ': critical must be boolean');
    need(integer(feature.currentLevel, 0, 4), id + ': currentLevel must be 0..4');
    need(integer(feature.supportedLevel, 0, 4), id + ': supportedLevel must be 0..4');
    if (integer(feature.currentLevel, 0, 4) && integer(feature.supportedLevel, 0, 4)) {
        need(feature.supportedLevel >= feature.currentLevel,
            id + ': supportedLevel cannot be below currentLevel');
    }
    need(integer(feature.complexity, 1, 5), id + ': complexity must be 1..5');
    need(own(REPRESENTATION, feature.representation), id + ': unsupported representation');
    need(own(REFERENCE, feature.referenceQuality), id + ': invalid referenceQuality');
    need(own(VISIBILITY, feature.visibility), id + ': invalid visibility');
    need(own(CONTACT, feature.contactRisk), id + ': invalid contactRisk');
    need(own(TOPOLOGY, feature.topologyRisk), id + ': invalid topologyRisk');
    need(Number.isInteger(feature.acceptedViews ?? plan.delivery?.acceptedViews)
        && (feature.acceptedViews ?? plan.delivery?.acceptedViews) > 0,
    id + ': acceptedViews must be positive');
    const signal = feature.smallestSignalMm;
    const voxel = feature.voxelMm;
    need((signal === undefined) === (voxel === undefined),
        id + ': smallestSignalMm and voxelMm must be supplied together');
    if (signal !== undefined) {
        need(positive(signal) && positive(voxel), id + ': signal and voxel must be positive');
    }
    const sampled = feature.representation === 'sampled-field' || feature.representation === 'hybrid';
    if (sampled && signal === undefined) {
        warnings.push(id + ': sampled representation lacks signal/voxel evidence');
    }
    if (!own(CATEGORY, feature.category)) {
        warnings.push(id + ': unlisted category uses default 1.5-cycle base');
    }
}

const thresholdIds = new Set();
for (const [index, threshold] of (plan.thresholds ?? []).entries()) {
    const id = threshold?.id || 'threshold-' + (index + 1);
    need(threshold && typeof threshold === 'object', id + ' must be an object');
    if (!threshold || typeof threshold !== 'object') continue;
    for (const key of ['id', 'label', 'definition']) {
        need(typeof threshold[key] === 'string' && !!threshold[key].trim(), id + ': ' + key + ' is required');
    }
    need(!thresholdIds.has(threshold.id), id + ': duplicate id');
    thresholdIds.add(threshold.id);
    need(finite(threshold.targetScore) && threshold.targetScore > 0
        && threshold.targetScore <= 100, id + ': targetScore must be 0..100');
    need(integer(threshold.defaultLevel, 0, 4), id + ': defaultLevel must be 0..4');
    need(integer(threshold.criticalMinimumLevel, 0, 4),
        id + ': criticalMinimumLevel must be 0..4');
    need(threshold.categoryMinimumLevels
        && typeof threshold.categoryMinimumLevels === 'object'
        && !Array.isArray(threshold.categoryMinimumLevels),
    id + ': categoryMinimumLevels must be an object');
    for (const level of Object.values(threshold.categoryMinimumLevels ?? {})) {
        need(integer(level, 0, 4), id + ': category levels must be 0..4');
    }
    if (plan.features?.length && threshold.categoryMinimumLevels
        && integer(threshold.defaultLevel, 0, 4)
        && integer(threshold.criticalMinimumLevel, 0, 4)) {
        const score = weightedScore(plan.features, (feature) => targetLevel(feature, threshold));
        need(score + 0.0001 >= threshold.targetScore,
            id + ': level profile scores ' + score.toFixed(2)
            + '%, below targetScore ' + threshold.targetScore + '%');
    }
}

const calibrationInput = plan.calibration ?? {};
const fallbackTokens = calibrationInput.fallbackTokensPerCycle ?? FALLBACK.tokens;
const fallbackHours = calibrationInput.fallbackActiveHoursPerCycle ?? FALLBACK.hours;
const audit = calibrationInput.auditCycles ?? FALLBACK.audit;
const closeout = calibrationInput.closeoutCycles ?? FALLBACK.closeout;
need(range(fallbackTokens), 'calibration.fallbackTokensPerCycle must be a positive range');
need(range(fallbackHours), 'calibration.fallbackActiveHoursPerCycle must be a positive range');
need(range(audit), 'calibration.auditCycles must be a positive range');
need(range(closeout), 'calibration.closeoutCycles must be a positive range');
need(Array.isArray(calibrationInput.samples ?? []), 'calibration.samples must be an array');

const tokenSamples = [];
const hourSamples = [];
for (const [index, sample] of (calibrationInput.samples ?? []).entries()) {
    need(sample && typeof sample === 'object', 'calibration sample ' + index + ' must be an object');
    if (!sample || typeof sample !== 'object') continue;
    need(sample.tokens !== undefined || sample.activeHours !== undefined,
        'calibration sample ' + index + ' needs tokens or activeHours');
    if (sample.tokens !== undefined) {
        need(positive(sample.tokens), 'calibration sample tokens must be positive');
        if (positive(sample.tokens)) tokenSamples.push(sample.tokens);
    }
    if (sample.activeHours !== undefined) {
        need(positive(sample.activeHours), 'calibration sample activeHours must be positive');
        if (positive(sample.activeHours)) hourSamples.push(sample.activeHours);
    }
    if (sample.accepted !== undefined) {
        need(typeof sample.accepted === 'boolean', 'calibration sample accepted must be boolean');
    }
}
if (!tokenSamples.length) warnings.push('No token samples: using low-confidence fallback range');
if (!hourSamples.length) warnings.push('No time samples: using low-confidence fallback range');

if (errors.length) {
    for (const warning of warnings) console.warn('WARN: ' + warning);
    for (const error of errors) console.error('ERROR: ' + error);
    console.error('FAIL: ' + errors.length + ' validation error(s)');
    process.exit(1);
}

const calibration = {
    source: typeof calibrationInput.source === 'string' && calibrationInput.source.trim()
        ? calibrationInput.source.trim() : 'uncalibrated skill defaults',
    tokensPerCycle: sampleRange(tokenSamples, fallbackTokens),
    activeHoursPerCycle: sampleRange(hourSamples, fallbackHours),
    auditCycles: audit,
    closeoutCycles: closeout,
    tokenSampleCount: tokenSamples.length,
    hourSampleCount: hourSamples.length,
    tokenConfidence: confidence(tokenSamples.length),
    timeConfidence: confidence(hourSamples.length),
};

const totalWeight = plan.features.reduce((sum, feature) => sum + feature.weight, 0);
const weightFor = (predicate) => plan.features.filter(predicate)
    .reduce((sum, feature) => sum + feature.weight, 0);
const referenceConfidence = plan.referenceSet.conflictingViews
    || plan.referenceSet.hiddenSurfaceFraction > 0.4
    || plan.features.some((feature) => feature.referenceQuality === 'poor')
    ? 'low'
    : plan.referenceSet.hiddenSurfaceFraction > 0.15
        || weightFor((feature) => feature.referenceQuality === 'partial') / totalWeight > 0.25
        ? 'medium' : 'high';
const inventoryConfidence = plan.features.some((feature) => (
    (feature.representation === 'sampled-field' || feature.representation === 'hybrid')
    && feature.smallestSignalMm === undefined
)) ? 'medium' : 'high';
const overallConfidence = lowest([
    referenceConfidence, inventoryConfidence,
    calibration.tokenConfidence, calibration.timeConfidence,
]);

let uncertainty = 0.15 + plan.referenceSet.hiddenSurfaceFraction * 0.6;
if (plan.referenceSet.conflictingViews) uncertainty += 0.3;
uncertainty += weightFor((feature) => feature.referenceQuality === 'partial') / totalWeight * 0.3;
uncertainty += weightFor((feature) => feature.referenceQuality === 'poor') / totalWeight * 0.65;
uncertainty += weightFor((feature) => (
    (feature.representation === 'sampled-field' || feature.representation === 'hybrid')
    && feature.smallestSignalMm === undefined
)) / totalWeight * 0.3;
if (!tokenSamples.length && !hourSamples.length) uncertainty += 0.3;
else if (Math.min(tokenSamples.length || Infinity, hourSamples.length || Infinity) < 4) {
    uncertainty += 0.15;
}
if (plan.referenceSet.viewCount < plan.delivery.acceptedViews) uncertainty += 0.1;
if (plan.delivery.fullOrbit) uncertainty += 0.08;
uncertainty = Math.min(1.4, uncertainty);

let selected = plan.thresholds;
if (cli.threshold !== null) {
    selected = plan.thresholds.filter((threshold) => threshold.id === cli.threshold
        || threshold.label === cli.threshold || String(threshold.targetScore) === cli.threshold);
    if (!selected.length) {
        console.error('No threshold matches ' + cli.threshold);
        process.exit(2);
    }
}

function evaluate(threshold) {
    const blockers = [];
    const risks = [];
    const drivers = [];
    for (const feature of plan.features) {
        const level = targetLevel(feature, threshold);
        const cycles = featureCycles(feature, level, plan.delivery);
        drivers.push({ id: feature.id, category: feature.category, targetLevel: level,
            targetName: LEVELS[level], nominalCycles: cycles });
        if (level > feature.supportedLevel) {
            blockers.push(feature.id + ': target level ' + level + ' exceeds supported level '
                + feature.supportedLevel + ' (' + feature.supportReason + ')');
        }
        const sampled = feature.representation === 'sampled-field'
            || feature.representation === 'hybrid';
        if (sampled && positive(feature.smallestSignalMm) && positive(feature.voxelMm)) {
            const rho = feature.smallestSignalMm / feature.voxelMm;
            if (rho < 3 && level >= 2) {
                blockers.push(feature.id + ': rho=' + rho.toFixed(2)
                    + ' cannot support semantic sampled geometry; change resolution or representation');
            } else if (rho < 6 && level >= 3) {
                risks.push(feature.id + ': rho=' + rho.toFixed(2)
                    + ' is fragile for reference-faithful geometry');
            }
        } else if (sampled && level >= 3) {
            risks.push(feature.id + ': sampled target lacks signal/voxel evidence');
        }
        if (level >= 4 && feature.referenceQuality === 'poor') {
            risks.push(feature.id + ': high-fidelity target has poor references');
        }
        if (level >= 4 && feature.visibility === 'mostly-hidden') {
            risks.push(feature.id + ': high-fidelity target reconstructs mostly hidden form');
        }
        const views = feature.acceptedViews ?? plan.delivery.acceptedViews;
        if (level >= 4 && views < 2
            && !['camera', 'material-lighting', 'performance'].includes(feature.category)) {
            risks.push(feature.id + ': high-fidelity 3D target has fewer than two accepted views');
        }
    }

    const nominal = drivers.reduce((sum, driver) => sum + driver.nominalCycles, 0);
    const deliveryOverhead = (plan.delivery.mobile ? 1 : 0)
        + (plan.delivery.fullOrbit ? 2 : 0)
        + (plan.delivery.performanceConstrained ? 1 : 0);
    const lowFactor = Math.max(0.55, 0.9 - uncertainty * 0.25);
    const highFactor = 1.2 + uncertainty;
    const cycles = [
        Math.ceil(nominal * lowFactor + audit[0] + closeout[0] + deliveryOverhead * 0.75),
        Math.ceil(nominal * highFactor + audit[1] + closeout[1] + deliveryOverhead * 1.5),
    ];
    const uniqueBlockers = [...new Set(blockers)];
    const uniqueRisks = [...new Set(risks)];
    return {
        id: threshold.id,
        label: threshold.label,
        definition: threshold.definition,
        targetScore: threshold.targetScore,
        profileScore: weightedScore(plan.features, (feature) => targetLevel(feature, threshold)),
        status: uniqueBlockers.length ? 'blocked' : uniqueRisks.length ? 'at-risk' : 'feasible',
        achievableAsScoped: uniqueBlockers.length === 0,
        cycles,
        nominalFeatureCycles: nominal,
        tokenRange: [
            Math.round(cycles[0] * calibration.tokensPerCycle[0]),
            Math.round(cycles[1] * calibration.tokensPerCycle[1]),
        ],
        activeHoursRange: [
            cycles[0] * calibration.activeHoursPerCycle[0],
            cycles[1] * calibration.activeHoursPerCycle[1],
        ],
        blockers: uniqueBlockers,
        risks: uniqueRisks,
        dominantDrivers: drivers.filter((driver) => driver.nominalCycles > 0)
            .sort((a, b) => b.nominalCycles - a.nominalCycles).slice(0, 5),
    };
}

const currentScore = weightedScore(plan.features, (feature) => feature.currentLevel);
const targets = selected.map(evaluate);
const result = {
    version: 1,
    project: plan.project,
    source,
    scoreType: 'weighted observable contract score; not perceptual similarity',
    levels: LEVELS,
    currentScore,
    confidence: {
        overall: overallConfidence,
        reference: referenceConfidence,
        inventory: inventoryConfidence,
        tokenCalibration: calibration.tokenConfidence,
        timeCalibration: calibration.timeConfidence,
        uncertaintyFactor: uncertainty,
    },
    calibration,
    warnings,
    factors: {
        categoryBase: CATEGORY,
        defaultCategoryBase: 1.5,
        levelStepCost: STEP,
        complexityMultiplier: COMPLEXITY,
        representationMultiplier: REPRESENTATION,
        referenceMultiplier: REFERENCE,
        visibilityMultiplier: VISIBILITY,
        contactMultiplier: CONTACT,
        topologyMultiplier: TOPOLOGY,
        difficultyFormula: 'geometric mean of complexity, representation, reference, visibility, contact and topology multipliers',
        viewFormula: 'min(1.75, 1 + 0.09 * (acceptedViews - 1))',
        repeatedCountFormula: '1 + (count - 1) * (1 - 0.75 * reuseFraction)',
    },
    targets,
};

if (cli.json) {
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log('Likeness effort estimate: ' + result.project);
    console.log('Source: ' + source);
    console.log('Current contract score: ' + currentScore.toFixed(2)
        + '% (observable rubric, not perceptual similarity)');
    console.log('Confidence: ' + overallConfidence + ' [reference=' + referenceConfidence
        + ', inventory=' + inventoryConfidence + ', tokens=' + calibration.tokenConfidence
        + ', time=' + calibration.timeConfidence + ']');
    console.log('Calibration: ' + calibration.source + '; token samples='
        + calibration.tokenSampleCount + ', time samples=' + calibration.hourSampleCount);
    for (const warning of warnings) console.warn('WARN: ' + warning);

    for (const target of targets) {
        console.log('');
        console.log(target.label + ' [' + target.status.toUpperCase() + ']');
        console.log('  Definition: ' + target.definition);
        console.log('  Declared target/profile score: ' + target.targetScore
            + '% / ' + target.profileScore.toFixed(2) + '%');
        console.log('  Validated iteration cycles: ' + target.cycles[0] + '-' + target.cycles[1]);
        if (target.blockers.length) {
            console.log('  Note: ranges still include work on blocked features;'
                + ' this target is NOT achievable as scoped until the blockers are resolved.');
        }
        console.log('  Active engineering time: ' + formatDecimal(target.activeHoursRange[0])
            + '-' + formatDecimal(target.activeHoursRange[1]) + ' hours');
        console.log('  Model tokens: ' + formatAmount(target.tokenRange[0]) + '-'
            + formatAmount(target.tokenRange[1]) + ' ('
            + calibration.tokenConfidence + ' calibration confidence)');
        if (target.dominantDrivers.length) {
            console.log('  Dominant feature work:');
            for (const driver of target.dominantDrivers) {
                console.log('    - ' + driver.id + ': ' + formatDecimal(driver.nominalCycles)
                    + ' nominal cycles to level ' + driver.targetLevel
                    + ' (' + driver.targetName + ')');
            }
        }
        if (target.blockers.length) {
            console.log('  Blockers:');
            for (const blocker of target.blockers) console.log('    - ' + blocker);
        }
        if (target.risks.length) {
            console.log('  Risks:');
            for (const risk of target.risks) console.log('    - ' + risk);
        }
    }
    console.log('');
    console.log('Re-estimate after 4-6 representative cycles; token and time ranges are planning bands, not guarantees.');
}

if (cli.strict && targets.some((target) => target.status === 'blocked')) {
    process.exitCode = 1;
}
