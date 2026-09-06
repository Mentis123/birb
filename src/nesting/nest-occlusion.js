/** Clear only the immediate perch camera, never a planet-wide instance batch.
 * Work/allocation happens on nesting transitions, not in the frame loop.
 * Original instance matrices are restored exactly on takeoff/reset.
 */
export function createNestOcclusion(THREE) {
  const hidden = [];
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const collapsed = new THREE.Matrix4().makeScale(0, 0, 0);
  function restore() {
    for (const entry of hidden) {
      entry.mesh.setMatrixAt(entry.index, entry.matrix);
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
    hidden.length = 0;
  }
  return {
    restore,
    get count() { return hidden.length; },
    clearNear(root, cameraPosition, radius = 5) {
      restore();
      if (!root || !cameraPosition) return;
      root.updateWorldMatrix(true, true);
      root.traverse((mesh) => {
        if (!mesh.isInstancedMesh || !mesh.visible ||
            !/^(forest-(trunks|canopies)|mountain-(pine|peaks)|canyon-(spires|corridor)|city-(towers|buildings))/.test(mesh.name)) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instance);
          world.multiplyMatrices(mesh.matrixWorld, instance);
          if (Math.abs(world.determinant()) < 1e-9) continue;
          world.decompose(position, rotation, scale);
          inverse.copy(world).invert();
          point.copy(cameraPosition).applyMatrix4(inverse);
          // Distance to this instance's oriented bounds in world units. Using
          // the batch bounding sphere would incorrectly select the whole planet.
          const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x) * Math.abs(scale.x);
          const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y) * Math.abs(scale.y);
          const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z) * Math.abs(scale.z);
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          hidden.push({ mesh, index: i, matrix: instance.clone() });
          mesh.setMatrixAt(i, collapsed);
          mesh.instanceMatrix.needsUpdate = true;
        }
      });
    },
  };
}
