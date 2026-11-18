import './build.mjs';
import {createServer}from'node:http';
import{readFile}from'node:fs/promises';
const root=new URL('./generated/',import.meta.url),manifest=JSON.parse(await readFile(new URL('assets.json',root))),allowed=new Set(manifest.files);
const mime={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',png:'image/png',webmanifest:'application/manifest+json'};
export const server=createServer(async(req,res)=>{try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end()}let p=new URL(req.url,'http://localhost').pathname;if(p==='/')p='/index.html';if(p==='/editor/'||p==='/editor')p='/editor/index.html';if(!allowed.has(p)){res.writeHead(404);return res.end()}const b=await readFile(new URL('.'+p,root));res.writeHead(200,{'Content-Type':mime[p.split('.').pop()]||'application/octet-stream','Cache-Control':'no-cache','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','X-Content-Type-Options':'nosniff','Service-Worker-Allowed':'/'});res.end(req.method==='HEAD'?undefined:b)}catch{res.writeHead(500);res.end('Prototype asset unavailable')}});
server.listen(Number(process.env.CAPTURE_PORT||4196),'127.0.0.1',()=>console.log('Capture prototype: http://localhost:'+server.address().port+' (loopback only)'));
