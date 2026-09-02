// Same 12-vert / 2-bone limb as the Assimp + Blender probes, written with ufbx-write.
#include "ufbx_write.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static ufbxw_node mknode(ufbxw_scene *s, const char *name, ufbxw_node parent, ufbxw_real ty) {
  ufbxw_node n = ufbxw_create_node(s);
  ufbxw_set_name(s, n.id, name);
  if (parent.id) ufbxw_node_set_parent(s, n, parent);
  ufbxw_vec3 t = { 0, ty, 0 }; ufbxw_node_set_translation(s, n, t);
  return n;
}
static ufbxw_matrix translation(ufbxw_real y) { ufbxw_matrix m = ufbxw_identity_matrix; m.m13 = y; return m; }

int main(int argc, char **argv) {
  const char *out = argc > 1 ? argv[1] : "ufbxw_limb.fbx";
  uint32_t version = argc > 2 ? (uint32_t)atoi(argv[2]) : 7400;
  ufbxw_scene *s = ufbxw_create_scene(NULL);

  // Skeleton: Armature -> Hips(y=0) -> Spine(y=1)
  ufbxw_node none = { 0 };
  ufbxw_node armature = mknode(s, "Armature", none, 0);
  ufbxw_node hips = mknode(s, "Hips", armature, 0);
  ufbxw_node spine = mknode(s, "Spine", hips, 1);
  ufbxw_create_bone(s, UFBXW_BONE_LIMB_NODE, hips);
  ufbxw_create_bone(s, UFBXW_BONE_LIMB_NODE, spine);

  // Mesh node
  ufbxw_node meshNode = mknode(s, "Limb", none, 0);
  ufbxw_mesh mesh = ufbxw_create_mesh(s);
  ufbxw_set_name(s, mesh.id, "LimbGeom");
  ufbxw_mesh_add_instance(s, mesh, meshNode);

  static ufbxw_vec3 verts[12]; static ufbxw_vec3 normals[12]; static ufbxw_vec2 uvs[12];
  const ufbxw_real sq[4][2] = {{-0.2,-0.2},{0.2,-0.2},{0.2,0.2},{-0.2,0.2}};
  for (int r = 0; r < 3; r++) for (int i = 0; i < 4; i++) {
    int v = r*4+i; verts[v].x = sq[i][0]; verts[v].y = (ufbxw_real)r; verts[v].z = sq[i][1];
    normals[v].x = sq[i][0]*3.5; normals[v].y = 0; normals[v].z = sq[i][1]*3.5;
    uvs[v].x = i/3.0; uvs[v].y = r/2.0;
  }
  // 8 side quads + 2 caps as polygons
  static int32_t idx[40]; static int32_t offs[11]; int n = 0, f = 0;
  for (int r = 0; r < 2; r++) for (int i = 0; i < 4; i++) { int a=r*4+i, b=r*4+(i+1)%4; offs[f++] = n; idx[n++]=a; idx[n++]=b; idx[n++]=b+4; idx[n++]=a+4; }
  offs[f++] = n; idx[n++]=3; idx[n++]=2; idx[n++]=1; idx[n++]=0;
  offs[f++] = n; idx[n++]=8; idx[n++]=9; idx[n++]=10; idx[n++]=11;
  offs[f++] = n;
  ufbxw_mesh_set_vertices(s, mesh, ufbxw_view_vec3_array(s, verts, 12));
  ufbxw_mesh_set_polygons(s, mesh, ufbxw_view_int_array(s, idx, n), ufbxw_view_int_array(s, offs, f));
  ufbxw_mesh_set_normals(s, mesh, ufbxw_view_vec3_array(s, normals, 12), UFBXW_ATTRIBUTE_MAPPING_VERTEX);
  ufbxw_mesh_set_uvs(s, mesh, 0, ufbxw_view_vec2_array(s, uvs, 12), UFBXW_ATTRIBUTE_MAPPING_VERTEX);

  // Material + texture (relative path, like the PRD's ZIP layout)
  ufbxw_material mat = ufbxw_create_material(s, UFBXW_MATERIAL_FBX_LAMBERT);
  ufbxw_set_name(s, mat.id, "Skin");
  ufbxw_vec3 diffuse = { 0.8, 0.6, 0.5 }; ufbxw_set_vec3(s, mat.id, "DiffuseColor", diffuse);
  ufbxw_texture tex = ufbxw_create_texture(s, UFBXW_TEXTURE_FILE);
  ufbxw_texture_set_relative_filename(s, tex, "Textures/Limb_Albedo.png");
  ufbxw_material_set_texture(s, mat, "DiffuseColor", tex);
  ufbxw_node_set_material(s, meshNode, 0, mat);
  ufbxw_mesh_set_single_material(s, mesh, 0);

  // Skin: Hips owns ring0 fully + ring1 half; Spine owns ring1 half + ring2 fully
  ufbxw_skin_deformer skin = ufbxw_create_skin_deformer(s, mesh);
  ufbxw_skin_deformer_set_skinning_type(s, skin, UFBXW_SKINNING_TYPE_LINEAR);
  ufbxw_skin_cluster cHips = ufbxw_create_skin_cluster(s, skin, hips);
  ufbxw_skin_cluster cSpine = ufbxw_create_skin_cluster(s, skin, spine);
  static int32_t hi[8] = {0,1,2,3,4,5,6,7}; static ufbxw_real hw[8] = {1,1,1,1,.5,.5,.5,.5};
  static int32_t si[8] = {4,5,6,7,8,9,10,11}; static ufbxw_real sw[8] = {.5,.5,.5,.5,1,1,1,1};
  ufbxw_skin_cluster_set_weights(s, cHips, ufbxw_view_int_array(s, hi, 8), ufbxw_view_real_array(s, hw, 8));
  ufbxw_skin_cluster_set_weights(s, cSpine, ufbxw_view_int_array(s, si, 8), ufbxw_view_real_array(s, sw, 8));
  ufbxw_skin_cluster_set_transform(s, cHips, ufbxw_identity_matrix);       // mesh world at bind
  ufbxw_skin_cluster_set_link_transform(s, cHips, translation(0));        // bone world at bind
  ufbxw_skin_cluster_set_transform(s, cSpine, ufbxw_identity_matrix);
  ufbxw_skin_cluster_set_link_transform(s, cSpine, translation(1));

  // Explicit bind pose (ufbxw_prepare_scene would also add one)
  ufbxw_bind_pose pose = ufbxw_create_bind_pose(s);
  ufbxw_bind_pose_add_node(s, pose, meshNode, ufbxw_identity_matrix);
  ufbxw_bind_pose_add_node(s, pose, armature, ufbxw_identity_matrix);
  ufbxw_bind_pose_add_node(s, pose, hips, translation(0));
  ufbxw_bind_pose_add_node(s, pose, spine, translation(1));
  ufbxw_skin_deformer_set_bind_pose(s, skin, pose);

  ufbxw_prepare_scene(s, &ufbxw_default_prepare_opts);
  ufbxw_save_opts o; memset(&o, 0, sizeof o); o.format = UFBXW_SAVE_FORMAT_BINARY; o.version = version;
  ufbxw_error err;
  if (!ufbxw_save_file(s, out, &o, &err)) { fprintf(stderr, "SAVE_FAIL %s\n", err.description); return 1; }
  printf("WROTE %s (FBX %u)\n", out, version);
  ufbxw_free_scene(s);
  return 0;
}
