import test from "node:test";
import assert from "node:assert/strict";
import { parsePostInput, isMediaUrl } from "../lib/urls";
import { signTicket, verifyTicket } from "../lib/tickets";
import { parsePinterest, parsePinterestResource } from "../lib/providers/pinterest";
import { parseTwitter } from "../lib/providers/twitter";
import { parseTikTok } from "../lib/providers/tiktok";
import { fetchAllowed, readBoundedText } from "../lib/network";
import { POST } from "../app/api/resolve/route";
import { GET } from "../app/api/file/route";

process.env.DOWNLOAD_SECRET = "test-secret-only-never-use-for-deployment-12345678";

test("share text extracts supported URL and strips tracking; slugs and X aliases work", () => {
  const pin = parsePostInput("Look at this! https://in.pinterest.com/pin/recipe-video--123456/?foo=tracking");
  assert.equal(pin.id,"123456"); assert.equal(pin.url.href,"https://www.pinterest.com/pin/123456/");
  assert.equal(parsePostInput("https://twitter.com/name/status/123456/video/2?s=20").platform,"twitter");
  assert.equal(parsePostInput("https://vm.tiktok.com/ZMAbc/").platform,"tiktok");
  assert.equal(parsePostInput("https://www.tiktok.com/@name/photo/123").id,"123");
});
test("URL boundaries reject credentials, lookalike domains, profiles, insecure URLs, and IPs", () => {
  for (const input of ["http://x.com/name/status/123", "https://user:pass@x.com/name/status/123", "https://x.com.evil.test/name/status/123", "https://127.0.0.1/foo", "https://x.com/name", "https://www.pinterest.com/board/", "https://www.tiktok.com/@name", "https://x.com:8443/name/status/123"]) assert.throws(() => parsePostInput(input));
  for (const input of ["https://video.twimg.com.evil.test/file.mp4", "https://127.0.0.1/file.mp4", "http://video.twimg.com/file.mp4", "https://video.twimg.com:444/file.mp4"]) assert.equal(isMediaUrl(input),false);
  assert.equal(isMediaUrl("https://video.twimg.com/file.mp4"),true);
});
test("download tickets reject tampering, expiration, unapproved URLs, and malformed tokens", () => {
  const now = Date.now();
  const ticket = {url:"https://video.twimg.com/file.mp4",filename:"file.mp4",mimeType:"video/mp4" as const};
  const token = signTicket(ticket,now);
  assert.equal(verifyTicket(token,now).url,ticket.url);
  const [payload,sig] = token.split(".");
  assert.throws(() => verifyTicket(`${payload}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`,now));
  assert.throws(() => verifyTicket(token,now+15*60_000));
  assert.throws(() => signTicket({...ticket,url:"https://example.com/file.mp4"}));
  assert.throws(() => verifyTicket("a.b.c"));
  assert.throws(() => verifyTicket(signTicket({...ticket,filename:"file\r\nInjected.mp4"},now),now));
});
test("Pinterest extracts only the canonical pin, excluding related clips", () => {
  const main = {"@type":"VideoObject","@id":"https://www.pinterest.com/pin/222/",name:"Own video",contentUrl:"https://v1.pinimg.com/videos/720p/own.mp4",thumbnailUrl:"https://i.pinimg.com/own.jpg"};
  const unrelated = {...main,"@id":"https://www.pinterest.com/pin/999/",contentUrl:"https://v1.pinimg.com/videos/720p/other.mp4"};
  const html = `<link href="https://www.pinterest.com/pin/222/" rel="canonical"><script type="application/ld+json">${JSON.stringify(main)}</script><script type="application/ld+json">${JSON.stringify(unrelated)}</script>`;
  const result = parsePinterest(html,"https://www.pinterest.com/pin/111/");
  assert.equal(result.sourceUrl,"https://www.pinterest.com/pin/222/");
  assert.equal(result.media.length,1);
  assert.equal(result.media[0].variants.length,1);
  assert.ok(result.media[0].variants[0].url.endsWith("own.mp4"));
});
test("Pinterest does not offer a video poster as the video when only HLS is exposed", () => {
  const pin = {id:"123",videos:{video_list:{V_HLSV4:{url:"https://v1.pinimg.com/videos/hls/file.m3u8"}}},images:{orig:{url:"https://i.pinimg.com/poster.jpg"}}};
  assert.throws(() => parsePinterest(`<script id="__PWS_INITIAL_PROPS__" type="application/json">${JSON.stringify({pins:{123:pin}})}</script>`,"https://www.pinterest.com/pin/123/"), /MP4/);
});
test("Pinterest image pin uses its original image, not a recommended image", () => {
  const posting = {"@type":"SocialMediaPosting",mainEntityOfPage:{"@id":"https://www.pinterest.com/pin/123/"},image:"https://i.pinimg.com/originals/own.png",headline:"Own image"};
  const result=parsePinterest(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`,"https://www.pinterest.com/pin/123/");
  assert.equal(result.media[0].type,"image"); assert.equal(result.media[0].variants[0].mimeType,"image/png");
});
test("Pinterest resource pins preserve own media and safely parse creator text", () => {
  const pin={id:"123",privacy:"public",grid_title:"My </script> pin",videos:{video_list:{V_720P:{url:"https://v1.pinimg.com/videos/720p/own.mp4",width:576,height:1024}}}};
  const result=parsePinterestResource({resource_response:{status:"success",data:pin}},"123");
  assert.equal(result.title,"My </script> pin"); assert.equal(result.media[0].type,"video");
  assert.throws(()=>parsePinterestResource({resource_response:{status:"success",data:{...pin,id:"999"}}},"123"));
  assert.throws(()=>parsePinterestResource({resource_response:{status:"success",data:{...pin,privacy:"secret"}}},"123"));
});
test("X keeps mixed media and sorts MP4 quality, skipping HLS", () => {
  const result = parseTwitter({id_str:"123",text:"Mixed",mediaDetails:[{type:"photo",media_url_https:"https://pbs.twimg.com/media/own.jpg"},{type:"video",media_url_https:"https://pbs.twimg.com/poster.jpg",video_info:{variants:[{content_type:"video/mp4",bitrate:100,url:"https://video.twimg.com/vid/320x180/a.mp4"},{content_type:"application/x-mpegURL",url:"https://video.twimg.com/file.m3u8"},{content_type:"video/mp4",bitrate:900,url:"https://video.twimg.com/vid/1280x720/b.mp4"}]}}]},"123");
  assert.equal(result.media.length,2); assert.equal(result.media[1].variants[0].label,"720p");
  assert.equal(result.media[1].variants.length,2);
  assert.ok(result.media[0].variants[0].url.includes("name=orig"));
  assert.throws(() => parseTwitter({id_str:"456"},"123"));
});
test("TikTok photo posts remain individually savable; blocked results are errors", () => {
  const result=parseTikTok({code:0,data:{id:"123",title:"Photos",images:["https://p16.tiktokcdn-us.com/a.jpeg","https://p16.tiktokcdn-us.com/b.jpeg"],play:"https://v16.tiktokcdn-us.com/background.mp4"}},"https://www.tiktok.com/@name/photo/123");
  assert.equal(result.media.length,2); assert.ok(result.media.every(m=>m.type === "image"));
  assert.throws(()=>parseTikTok({code:-1,msg:"blocked"},"https://www.tiktok.com/@name/video/123"));
});
test("network rejects a redirect to an internal host before fetching it", async () => {
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:"https://127.0.0.1/private"}})};
  try { await assert.rejects(fetchAllowed("https://video.twimg.com/file.mp4",isMediaUrl)); assert.equal(calls,1); }
  finally {globalThis.fetch=original;}
});
test("text reader bounds untrusted page responses", async () => {
  await assert.rejects(readBoundedText(new Response("too much text"),3));
});
test("API rejects malformed bodies and foreign origins without contacting providers", async () => {
  assert.equal((await POST(new Request("https://pocket.test/api/resolve",{method:"POST",headers:{origin:"https://evil.test","content-type":"application/json"},body:JSON.stringify({url:"https://x.com/name/status/123"})}))).status,403);
  assert.equal((await POST(new Request("https://pocket.test/api/resolve",{method:"POST",headers:{"content-type":"application/json"},body:"{"}))).status,400);
  // Same-origin requests through a bind address must pass the origin gate.
  assert.equal((await POST(new Request("http://0.0.0.0:3017/api/resolve",{method:"POST",headers:{host:"localhost:3017",origin:"http://localhost:3017","content-type":"application/json"},body:"{"}))).status,400);
});
test("file route streams a valid MP4 attachment larger than 4.5MB", async () => {
  const original=globalThis.fetch;
  const chunk = new Uint8Array(1024*1024);
  chunk.set([0,0,0,24,102,116,121,112]);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<6;i++)c.enqueue(chunk);c.close();}}),{headers:{"content-type":"video/mp4","content-length":String(chunk.byteLength*6)}});
  try {
    const token=signTicket({url:"https://video.twimg.com/file.mp4",filename:"file.mp4",mimeType:"video/mp4"});
    const response=await GET(new Request(`https://pocket.test/api/file?token=${token}`));
    assert.equal(response.status,200); assert.equal(response.headers.get("content-type"),"video/mp4");
    assert.ok(response.headers.get("content-disposition")?.includes('filename="file.mp4"'));
    assert.equal((await response.arrayBuffer()).byteLength,6*1024*1024);
  } finally { globalThis.fetch=original; }
});
