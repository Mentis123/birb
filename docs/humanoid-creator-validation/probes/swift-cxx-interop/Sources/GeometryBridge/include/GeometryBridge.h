#pragma once
#include <vector>
#include <cstdint>
struct PickHit { bool hit; float t; uint32_t prim; };
class BVHPicker {
public:
  BVHPicker();
  ~BVHPicker();
  void build(const float* xyz, uint32_t triCount);   // 9 floats per tri
  PickHit pick(float ox, float oy, float oz, float dx, float dy, float dz) const;
private:
  struct Impl; Impl* impl;
};
