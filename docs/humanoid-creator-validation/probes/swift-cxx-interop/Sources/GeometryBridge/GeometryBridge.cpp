#define TINYBVH_IMPLEMENTATION
#include "tiny_bvh.h"
#include "GeometryBridge.h"
struct BVHPicker::Impl { tinybvh::BVH bvh; std::vector<tinybvh::bvhvec4> tris; };
BVHPicker::BVHPicker() : impl(new Impl) {}
BVHPicker::~BVHPicker() { delete impl; }
void BVHPicker::build(const float* xyz, uint32_t triCount) {
  impl->tris.resize(triCount * 3);
  for (uint32_t i = 0; i < triCount * 3; i++) impl->tris[i] = tinybvh::bvhvec4(xyz[i*3], xyz[i*3+1], xyz[i*3+2], 0);
  impl->bvh.Build(impl->tris.data(), triCount);
}
PickHit BVHPicker::pick(float ox, float oy, float oz, float dx, float dy, float dz) const {
  tinybvh::Ray r(tinybvh::bvhvec3(ox, oy, oz), tinybvh::bvhvec3(dx, dy, dz));
  impl->bvh.Intersect(r);
  return PickHit{ r.hit.t < 1e30f, r.hit.t, r.hit.prim };
}
