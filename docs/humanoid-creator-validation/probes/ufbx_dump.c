#include "ufbx.h"
#include <stdio.h>
int main(int argc, char** argv) {
  for (int a = 1; a < argc; a++) {
    ufbx_error err; ufbx_scene* s = ufbx_load_file(argv[a], NULL, &err);
    if (!s) { printf("UFBX_FAIL %s : %s\n", argv[a], err.description.data); continue; }
    size_t verts = 0; int maxw = 0;
    for (size_t i = 0; i < s->meshes.count; i++) { verts += s->meshes.data[i]->num_vertices;
      for (size_t d = 0; d < s->meshes.data[i]->skin_deformers.count; d++) { int w = (int)s->meshes.data[i]->skin_deformers.data[d]->max_weights_per_vertex; if (w > maxw) maxw = w; } }
    printf("UFBX_OK %s version=%u meshes=%zu bones=%zu skins=%zu clusters=%zu poses=%zu verts=%zu maxW=%d materials=%zu textures=%zu\n", argv[a], s->metadata.version, s->meshes.count, s->bones.count, s->skin_deformers.count, s->skin_clusters.count, s->poses.count, verts, maxw, s->materials.count, s->textures.count);
    for (size_t c = 0; c < s->skin_clusters.count; c++) { ufbx_skin_cluster* k = s->skin_clusters.data[c]; printf("   cluster %s bone=%s weights=%zu bindT=(%.2f %.2f %.2f)\n", k->name.data, k->bone_node ? k->bone_node->name.data : "?", k->weights.count, k->bind_to_world.cols[3].x, k->bind_to_world.cols[3].y, k->bind_to_world.cols[3].z); }
    ufbx_free_scene(s);
  }
  return 0;
}
