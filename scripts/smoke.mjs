// Real provider verification. No tickets or full media URLs are printed.
const base = process.argv[2] ?? 'http://localhost:3017';
const cases = [
  ['Pinterest','https://www.pinterest.com/pin/526569381450179000/'],
  ['X','https://x.com/oshtru/status/1577855540407197696'],
  ['TikTok','https://www.tiktok.com/@scout2015/video/6718335390845095173'],
];
let failures=0;
for (const [name,url] of cases) {
  try {
    const response=await fetch(`${base}/api/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(60_000)});
    const data=await response.json();
    if(!response.ok)throw new Error(`${response.status}: ${data.error}`);
    console.log(name,'resolved',data.media.map(m=>`${m.type} (${m.variants.length} qualities)`).join(', '));
    for(const item of data.media){
      const v=item.variants[0];
      const file=await fetch(new URL(v.downloadUrl,base),{signal:AbortSignal.timeout(120_000)});
      if(!file.ok)throw new Error(`file ${file.status}: ${await file.text()}`);
      let bytes=0; let signature;
      for await(const part of file.body){bytes+=part.byteLength;if(!signature)signature=Buffer.from(part.subarray(0,16));}
      if(item.type==='video' && signature?.toString('ascii',4,8)!=='ftyp')throw new Error('Not a playable MP4 signature');
      if(bytes<1000)throw new Error('File unexpectedly small');
      console.log(name,item.type,'downloaded',bytes,'bytes',file.headers.get('content-type'),bytes>4_500_000?'(> Vercel buffered limit)':'');
    }
  }catch(error){console.error(name,'FAILED',error.message);failures++;}
}
process.exitCode=failures?1:0;
