import struct, zlib, os, sys, gzip, collections, tarfile, glob
import xml.etree.ElementTree as ET
PLAT={1:'macOS',2:'iOS',3:'tvOS',4:'watchOS',5:'bridgeOS',6:'macCatalyst',7:'iOS-simulator',8:'tvOS-sim',9:'watchOS-sim',10:'DriverKit',11:'visionOS',12:'visionOS-sim'}
CPU={0x0100000c:'arm64',0x01000007:'x86_64',0xc:'arm',0x7:'i386'}
def ver(v): return f'{v>>16}.{(v>>8)&0xff}.{v&0xff}'
def parse_macho(b):
    if len(b)<32: return None
    magic,=struct.unpack('<I',b[:4])
    if magic!=0xfeedfacf: return None
    cputype,cpusub,ft,ncmds,sizeofcmds,flags,res=struct.unpack('<IIIIIII',b[4:32])
    off=32; info={'cpu':CPU.get(cputype,hex(cputype)),'plat':None,'minos':None,'sdk':None,'bitcode':False}
    for _ in range(ncmds):
        cmd,sz=struct.unpack('<II',b[off:off+8])
        if cmd==0x32:
            plat,minos,sdk,ntools=struct.unpack('<IIII',b[off+8:off+24]); info['plat']=PLAT.get(plat,plat); info['minos']=ver(minos); info['sdk']=ver(sdk)
        elif cmd==0x25: info['plat']='iOS(LC_VERSION_MIN_IPHONEOS)'; info['minos']=ver(struct.unpack('<I',b[off+8:off+12])[0]); info['sdk']=ver(struct.unpack('<I',b[off+12:off+16])[0])
        elif cmd==0x24: info['plat']='macOS(LC_VERSION_MIN_MACOSX)'; info['minos']=ver(struct.unpack('<I',b[off+8:off+12])[0])
        elif cmd==0x19:
            if b[off+8:off+24].rstrip(b'\0')==b'__LLVM': info['bitcode']=True
        off+=sz
    return info
def analyze_ar(name,d):
    out=[]
    if d[:4]==b'\xca\xfe\xba\xbe':
        n,=struct.unpack('>I',d[4:8]); slices=[]
        for i in range(n):
            ct,cs,o,s,a=struct.unpack('>IIIII',d[8+20*i:28+20*i]); slices.append(d[o:o+s])
        print(f'   FAT with {n} slices')
    else: slices=[d]
    for sl in slices:
        if sl[:8]!=b'!<arch>\n': print('   not ar:',sl[:8]); continue
        off=8; objs=[]
        while off+60<=len(sl):
            hdr=sl[off:off+60]; nm=hdr[:16].decode('latin-1').strip(); size=int(hdr[48:58]); off+=60
            data=sl[off:off+size]
            if nm.startswith('#1/'): k=int(nm[3:]); data=data[k:]
            i=parse_macho(data)
            if i: objs.append(i)
            off+=size; off+=off&1
        c=collections.Counter((i['cpu'],i['plat'],i['minos'],i['sdk'],i['bitcode']) for i in objs)
        for k,v in c.most_common(): print('   cpu=%s platform=%s minos=%s sdk=%s bitcode=%s  x%d objs'%(k+(v,)))
def main(tgz):
    tf=tarfile.open(tgz); pkg=[m for m in tf.getmembers() if m.name.endswith('.pkg')][0]
    d=tf.extractfile(pkg).read(); print('pkg',pkg.name,len(d))
    magic,hsz,v,tcl,tul,ck=struct.unpack('>4sHHQQI',d[:28]); toc=zlib.decompress(d[hsz:hsz+tcl]).decode(); heap=hsz+tcl
    root=ET.fromstring(toc); payload=None
    def walk(f,prefix):
        nonlocal payload
        nm=f.findtext('name') or ''; p=prefix+'/'+nm; data=f.find('data')
        if data is not None and nm=='Payload':
            o=int(data.findtext('offset')); l=int(data.findtext('length')); payload=d[heap+o:heap+o+l]
        for c in f.findall('file'): walk(c,p)
    for f in root.find('toc').findall('file'): walk(f,'')
    if payload[:2]==b'\x1f\x8b': payload=gzip.decompress(payload)
    d=payload; off=0
    while off<len(d):
        if d[off:off+6]!=b'070707': print('cpio?',d[off:off+6]); break
        hdr=d[off:off+76]; namesize=int(hdr[59:65],8); filesize=int(hdr[65:76],8)
        name=d[off+76:off+76+namesize-1].decode('utf-8','ignore'); off+=76+namesize; data=d[off:off+filesize]; off+=filesize
        if name=='TRAILER!!!': break
        if name.endswith('libfbxsdk.a') or name.endswith('libfbxsdk.dylib'):
            print(f'\n== {name}  {filesize/1e6:.1f} MB'); analyze_ar(name,data)
        if name.endswith('fbxsdk_version.h'):
            import re; print('\n== version header:',re.findall(r'#define FBXSDK_VERSION_(MAJOR|MINOR|POINT)\s+(\d+)',data.decode('latin-1')))
main(sys.argv[1])
