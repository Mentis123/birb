import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createRibbonTrail, ribbonSegmentWeight, ribbonSegmentAlpha } from '../src/effects/ribbon-trail.js';

/**
 * A minimal Three stand-in that COUNTS construction. The point of these tests
 * is not that the ribbon draws — a unit test cannot know that — but that it
 * never allocates while updating, which is the house rule the frame loop
 * depends on and the thing a renderer would hide.
 */
function makeFakeTHREE() {
  const counts = { vector: 0, attribute: 0, geometry: 0, material: 0, mesh: 0 };
  class CountingVector3 extends Vector3 {
    constructor(x, y, z) { super(x, y, z); counts.vector++; }
    distanceToSquared(v) {
      const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
      return dx * dx + dy * dy + dz * dz;
    }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  }
  class BufferAttribute {
    constructor(array, itemSize) { counts.attribute++; this.array = array; this.itemSize = itemSize; this.needsUpdate = false; }
  }
  class BufferGeometry {
    constructor() { counts.geometry++; this.attributes = {}; this.drawRange = { start: 0, count: 0 }; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; }
    setIndex(attribute) { this.index = attribute; }
    setDrawRange(start, count) { this.drawRange = { start, count }; }
    dispose() { this.disposed = true; }
  }
  class MeshBasicMaterial {
    constructor(options) { counts.material++; Object.assign(this, options); }
    dispose() { this.disposed = true; }
  }
  class Mesh {
    constructor(geometry, material) { counts.mesh++; this.geometry = geometry; this.material = material; this.visible = true; }
  }
  return {
    THREE: { Vector3: CountingVector3, BufferAttribute, BufferGeometry, MeshBasicMaterial, Mesh, DoubleSide: 2, AdditiveBlending: 2 },
    counts,
  };
}

const at = (x, y, z) => ({ x, y, z });
const side = { x: 0, y: 1, z: 0 };

test('the taper runs from nothing at the tail to full at the wingtip', () => {
  assert.equal(ribbonSegmentWeight(0, 8), 0);
  assert.equal(ribbonSegmentWeight(7, 8), 1);
  assert.ok(ribbonSegmentWeight(3, 8) < ribbonSegmentWeight(5, 8));
});

test('the oldest vertex reaches exactly zero alpha', () => {
  // Anything above zero leaves a hard-edged strip hanging in mid air where the
  // ribbon ends, which is far more noticeable than the ribbon itself.
  assert.equal(ribbonSegmentAlpha(0, 12, 1), 0);
  assert.equal(ribbonSegmentAlpha(11, 12, 1), 1);
  assert.equal(ribbonSegmentAlpha(11, 12, 0.5), 0.5);
});

test('a single segment or a degenerate count does not divide by zero', () => {
  for (const segments of [0, 1, -3, NaN]) {
    assert.ok(Number.isFinite(ribbonSegmentWeight(0, segments)));
    assert.ok(Number.isFinite(ribbonSegmentAlpha(0, segments, 1)));
  }
});

test('updating the ribbon allocates nothing after construction', () => {
  const { THREE, counts } = makeFakeTHREE();
  const ribbon = createRibbonTrail(THREE, { segments: 10 });
  const after = { ...counts };
  for (let i = 0; i < 200; i++) {
    ribbon.update(at(i * 0.5, 0, 0), side, 1 / 60, 1);
  }
  assert.deepEqual(counts, after, 'update() must not construct anything');
});

test('the ring buffer never grows past its segment count', () => {
  const { THREE } = makeFakeTHREE();
  const ribbon = createRibbonTrail(THREE, { segments: 8 });
  for (let i = 0; i < 500; i++) ribbon.update(at(i, 0, 0), side, 1 / 60, 1);
  assert.equal(ribbon.length, 8);
  assert.equal(ribbon.mesh.geometry.attributes.position.array.length, 8 * 2 * 3);
});

test('a stationary wingtip does not pile every rung onto one point', () => {
  const { THREE } = makeFakeTHREE();
  const ribbon = createRibbonTrail(THREE, { segments: 12, minStep: 0.1 });
  for (let i = 0; i < 60; i++) ribbon.update(at(5, 5, 5), side, 1 / 60, 1);
  assert.equal(ribbon.length, 1, 'a hovering bird should record one rung, not sixty');
  assert.equal(ribbon.mesh.visible, false, 'one rung is not a ribbon');
});

test('fading out clears the history so it cannot streak across the map', () => {
  const { THREE } = makeFakeTHREE();
  const ribbon = createRibbonTrail(THREE, { segments: 8 });
  for (let i = 0; i < 40; i++) ribbon.update(at(i, 0, 0), side, 1 / 60, 1);
  assert.ok(ribbon.length > 1);
  // Hold at zero long enough to fully fade.
  for (let i = 0; i < 200; i++) ribbon.update(at(1000, 0, 0), side, 1 / 60, 0);
  assert.equal(ribbon.length, 0, 'a faded ribbon must forget where it was');
  assert.equal(ribbon.mesh.visible, false);
  // Reappearing far away must start fresh rather than drawing one long streak.
  ribbon.update(at(1000, 0, 0), side, 1 / 60, 1);
  ribbon.update(at(1000.5, 0, 0), side, 1 / 60, 1);
  assert.equal(ribbon.length, 2);
});

test('intensity ramps in faster than it ramps out', () => {
  const { THREE } = makeFakeTHREE();
  const ribbon = createRibbonTrail(THREE, { segments: 8 });
  ribbon.update(at(0, 0, 0), side, 0.1, 1);
  const rampedIn = ribbon.intensity;
  ribbon.update(at(1, 0, 0), side, 0.1, 0);
  const remaining = ribbon.intensity;
  assert.ok(rampedIn > 0.5, `expected a quick ramp in, got ${rampedIn}`);
  assert.ok(remaining > rampedIn * 0.4, 'the fade out must be gentler than the ramp in');
});

test('the index buffer covers every rung and is built once', () => {
  const { THREE } = makeFakeTHREE();
  const segments = 9;
  const ribbon = createRibbonTrail(THREE, { segments });
  assert.equal(ribbon.mesh.geometry.index.array.length, (segments - 1) * 6);
  const before = ribbon.mesh.geometry.index.array;
  for (let i = 0; i < 50; i++) ribbon.update(at(i, 0, 0), side, 1 / 60, 1);
  assert.equal(ribbon.mesh.geometry.index.array, before, 'indices must never be rebuilt');
});
