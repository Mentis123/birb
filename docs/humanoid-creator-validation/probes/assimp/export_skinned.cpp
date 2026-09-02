// Builds a minimal skinned scene (12 verts, 2 bones, 2 weights on middle ring) and exports it.
#include <assimp/Exporter.hpp>
#include <assimp/scene.h>
#include <assimp/postprocess.h>
#include <cstdio>
#include <cstring>
#include <string>

static aiNode* mkNode(const char* name, aiNode* parent, float ty) {
  aiNode* n = new aiNode(name);
  n->mParent = parent;
  n->mTransformation = aiMatrix4x4(); n->mTransformation.a4 = 0; n->mTransformation.b4 = ty; n->mTransformation.c4 = 0;
  return n;
}
static void addChild(aiNode* p, aiNode* c) {
  aiNode** arr = new aiNode*[p->mNumChildren + 1];
  for (unsigned i = 0; i < p->mNumChildren; i++) arr[i] = p->mChildren[i];
  arr[p->mNumChildren] = c; delete[] p->mChildren; p->mChildren = arr; p->mNumChildren++;
}

int main(int argc, char** argv) {
  const char* outDir = argc > 1 ? argv[1] : ".";
  aiScene* scene = new aiScene();
  scene->mRootNode = new aiNode("Root");

  // Mesh
  aiMesh* mesh = new aiMesh(); mesh->mName = aiString("Limb");
  mesh->mPrimitiveTypes = aiPrimitiveType_TRIANGLE;
  mesh->mNumVertices = 12; mesh->mVertices = new aiVector3D[12]; mesh->mNormals = new aiVector3D[12];
  mesh->mTextureCoords[0] = new aiVector3D[12]; mesh->mNumUVComponents[0] = 2;
  const float sq[4][2] = {{-0.2f,-0.2f},{0.2f,-0.2f},{0.2f,0.2f},{-0.2f,0.2f}};
  for (int r = 0; r < 3; r++) for (int i = 0; i < 4; i++) {
    int v = r*4+i; mesh->mVertices[v] = aiVector3D(sq[i][0], (float)r, sq[i][1]);
    mesh->mNormals[v] = aiVector3D(sq[i][0], 0, sq[i][1]).Normalize();
    mesh->mTextureCoords[0][v] = aiVector3D(i/3.0f, r/2.0f, 0);
  }
  // faces: 8 quads on sides -> 16 tris, plus 2 caps -> 4 tris
  mesh->mNumFaces = 20; mesh->mFaces = new aiFace[20]; int f = 0;
  auto tri = [&](unsigned a, unsigned b, unsigned c){ aiFace& F = mesh->mFaces[f++]; F.mNumIndices = 3; F.mIndices = new unsigned[3]{a,b,c}; };
  for (int r = 0; r < 2; r++) for (int i = 0; i < 4; i++) { unsigned a=r*4+i, b=r*4+(i+1)%4, c=b+4, d=a+4; tri(a,b,c); tri(a,c,d); }
  tri(3,2,1); tri(3,1,0); tri(8,9,10); tri(8,10,11);
  mesh->mMaterialIndex = 0;

  // Bones
  mesh->mNumBones = 2; mesh->mBones = new aiBone*[2];
  aiBone* hips = new aiBone(); hips->mName = aiString("Hips"); hips->mOffsetMatrix = aiMatrix4x4();
  hips->mNumWeights = 8; hips->mWeights = new aiVertexWeight[8];
  for (int i = 0; i < 4; i++) { hips->mWeights[i] = aiVertexWeight(i, 1.0f); hips->mWeights[4+i] = aiVertexWeight(4+i, 0.5f); }
  aiBone* spine = new aiBone(); spine->mName = aiString("Spine"); spine->mOffsetMatrix = aiMatrix4x4(); spine->mOffsetMatrix.b4 = -1.0f; // inverse of translate(0,1,0)
  spine->mNumWeights = 8; spine->mWeights = new aiVertexWeight[8];
  for (int i = 0; i < 4; i++) { spine->mWeights[i] = aiVertexWeight(4+i, 0.5f); spine->mWeights[4+i] = aiVertexWeight(8+i, 1.0f); }
  mesh->mBones[0] = hips; mesh->mBones[1] = spine;
  scene->mNumMeshes = 1; scene->mMeshes = new aiMesh*[1]{mesh};

  // Material
  aiMaterial* mat = new aiMaterial(); aiString mn("Skin"); mat->AddProperty(&mn, AI_MATKEY_NAME);
  aiColor3D col(0.8f,0.6f,0.5f); mat->AddProperty(&col,1,AI_MATKEY_COLOR_DIFFUSE);
  aiString tex("Textures/Limb_Albedo.png"); mat->AddProperty(&tex, AI_MATKEY_TEXTURE_DIFFUSE(0));
  scene->mNumMaterials = 1; scene->mMaterials = new aiMaterial*[1]{mat};

  // Nodes: Root -> Armature -> Hips -> Spine ; Root -> LimbNode(mesh)
  aiNode* armature = mkNode("Armature", scene->mRootNode, 0);
  aiNode* nHips = mkNode("Hips", armature, 0); aiNode* nSpine = mkNode("Spine", nHips, 1.0f);
  addChild(armature, nHips); addChild(nHips, nSpine); addChild(scene->mRootNode, armature);
  aiNode* meshNode = mkNode("Limb", scene->mRootNode, 0); meshNode->mNumMeshes = 1; meshNode->mMeshes = new unsigned[1]{0};
  addChild(scene->mRootNode, meshNode);
  hips->mArmature = armature; hips->mNode = nHips; spine->mArmature = armature; spine->mNode = nSpine;

  Assimp::Exporter ex;
  const char* fmts[][2] = {{"fbx", "assimp_limb.fbx"}, {"fbxa", "assimp_limb_ascii.fbx"}, {"gltf2", "assimp_limb.gltf"}, {"glb2", "assimp_limb.glb"}, {"collada", "assimp_limb.dae"}};
  for (auto& fm : fmts) {
    std::string path = std::string(outDir) + "/" + fm[1];
    aiReturn r = ex.Export(scene, fm[0], path.c_str(), 0);
    printf("%-8s -> %s : %s %s\n", fm[0], path.c_str(), r == AI_SUCCESS ? "OK" : "FAIL", r == AI_SUCCESS ? "" : ex.GetErrorString());
  }
  return 0;
}
