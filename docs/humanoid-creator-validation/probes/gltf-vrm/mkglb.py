# Minimal skinned GLB: 2 joints, a 4-vertex quad (2 tris), JOINTS_0/WEIGHTS_0, inverseBindMatrices, embedded 1x1 PNG, pbr material.
import struct, json, math, zlib
def png1x1():
    def chunk(t,d): c=struct.pack('>I',len(d))+t+d; return c+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    ihdr=struct.pack('>IIBBBBB',1,1,8,2,0,0,0)
    raw=b'\x00\xff\x80\x40'
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
def pad4(b,fill=b'\x00'): return b+fill*((4-len(b)%4)%4)
pos=[(-0.5,0,0),(0.5,0,0),(-0.5,1,0),(0.5,1,0)]
nrm=[(0,0,1)]*4; uv=[(0,1),(1,1),(0,0),(1,0)]
joints=[(0,0,0,0),(0,0,0,0),(1,0,0,0),(1,0,0,0)]
weights=[(1,0,0,0)]*4
idx=[0,1,2,2,1,3]
bin_=b''; views=[]; accs=[]
def add(data,target=None,stride=None):
    global bin_
    off=len(bin_); bin_+=pad4(data)
    v={"buffer":0,"byteOffset":off,"byteLength":len(data)}
    if target: v["target"]=target
    if stride: v["byteStride"]=stride
    views.append(v); return len(views)-1
def acc(view,ctype,count,typ,mn=None,mx=None,norm=None):
    a={"bufferView":view,"componentType":ctype,"count":count,"type":typ}
    if mn is not None: a["min"]=mn; a["max"]=mx
    if norm: a["normalized"]=True
    accs.append(a); return len(accs)-1
f=lambda arr: b''.join(struct.pack('<'+'f'*len(t),*t) for t in arr)
aP=acc(add(f(pos),34962),5126,4,"VEC3",[-0.5,0,0],[0.5,1,0])
aN=acc(add(f(nrm),34962),5126,4,"VEC3")
aT=acc(add(f(uv),34962),5126,4,"VEC2")
aJ=acc(add(b''.join(struct.pack('<4B',*j) for j in joints),34962),5121,4,"VEC4")
aW=acc(add(f(weights),34962),5126,4,"VEC4")
aI=acc(add(struct.pack('<6H',*idx),34963),5123,6,"SCALAR")
# inverse bind matrices: joint0 at origin, joint1 at y=0.5 -> ibm translates by -0.5
I=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
ibm1=I[:]; ibm1[13]=-0.5
aIBM=acc(add(f([tuple(I),tuple(ibm1)])),5126,2,"MAT4")
png=png1x1(); vPNG=add(png)
gltf={"asset":{"version":"2.0","generator":"mkglb-spike"},"scene":0,
 "scenes":[{"nodes":[0,1]}],
 "nodes":[{"name":"Armature","children":[2]},
          {"name":"Mesh","mesh":0,"skin":0},
          {"name":"Hips","translation":[0,0,0],"children":[3]},
          {"name":"Spine","translation":[0,0.5,0]}],
 "skins":[{"name":"Skin","skeleton":2,"joints":[2,3],"inverseBindMatrices":aIBM}],
 "meshes":[{"primitives":[{"attributes":{"POSITION":aP,"NORMAL":aN,"TEXCOORD_0":aT,"JOINTS_0":aJ,"WEIGHTS_0":aW},"indices":aI,"material":0}]}],
 "materials":[{"name":"Albedo","pbrMetallicRoughness":{"baseColorTexture":{"index":0},"metallicFactor":0,"roughnessFactor":0.8}}],
 "textures":[{"source":0,"sampler":0}],"samplers":[{"magFilter":9729,"minFilter":9987,"wrapS":10497,"wrapT":10497}],
 "images":[{"bufferView":vPNG,"mimeType":"image/png","name":"albedo"}],
 "bufferViews":views,"accessors":accs,"buffers":[{"byteLength":len(bin_)}]}
js=pad4(json.dumps(gltf,separators=(',',':')).encode(),b' ')
body=struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin_),0x004E4942)+bin_
glb=struct.pack('<III',0x46546C67,2,12+len(body))+body
open('spike.glb','wb').write(glb); print('wrote',len(glb),'bytes')
