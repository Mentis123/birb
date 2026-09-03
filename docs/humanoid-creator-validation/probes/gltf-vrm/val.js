const fs=require('fs'); const v=require('gltf-validator');
v.validateBytes(new Uint8Array(fs.readFileSync(process.argv[2]))).then(r=>{console.log(JSON.stringify({validator:r.validatorVersion,issues:r.issues,info:r.info},null,1))}).catch(e=>{console.error(e);process.exit(1)});
