import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const root=fileURLToPath(new URL('./',import.meta.url));
const campaign=JSON.parse(await readFile(join(root,'campaign.json'),'utf8'));
const files=campaign.thread.map(p=>p.image).filter(Boolean);
const weighted=s=>[...s.replace(/https:\/\/[^\s]+/g,'x'.repeat(23))].reduce((n,c)=>n+(c.codePointAt(0)>0x10ff?2:1),0);
for(const [i,p]of campaign.thread.entries()){const n=weighted(p.text);if(n>280)throw new Error(`Thread post ${i+1}: ${n} characters`)}
for(const p of campaign.standalone)if(weighted(p.text)>280)throw new Error(`Standalone ${p.name} too long`);
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;let data,type='text/html';
  if(path==='/campaign.json'){data=JSON.stringify(campaign);type='application/json'}
  else if(path==='/source.html')data=await readFile(join(root,'source.html'));
  else if(path==='/release-card.html')data=await readFile(join(root,'release-card.html'));
  else if(/^\/fonts\/(terminal-grotesque|GeistMono-Variable|GeistPixel-Square)\.woff2$/.test(path)){data=await readFile(join(root,'../source',path.slice(1)));type='font/woff2'}
  else if(files.some(f=>path==='/'+f)){data=await readFile(join(root,path.slice(1)));type='image/png'}
  else{return res.writeHead(404).end()}res.writeHead(200,{'content-type':type}).end(data);
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const port=server.address().port;
let browser;
try{
browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage();await page.setViewport({width:1600,height:900,deviceScaleFactor:1});
for(const [i,file]of files.entries()){await page.goto(`http://127.0.0.1:${port}/source.html?slide=${i}`,{waitUntil:'networkidle0'});await page.waitForSelector('body[data-ready="1"]');
const overflow=await page.evaluate(()=>[...document.querySelectorAll('.panel,.title,.body,.footer')].filter(el=>el.scrollHeight>el.clientHeight+2||el.getBoundingClientRect().bottom>860).map(el=>el.className));if(overflow.length)throw new Error(`Overflow in ${file}: ${overflow}`);
await page.screenshot({path:join(root,file)});console.log(`Rendered ${file}`)}
await page.setViewport({width:1600,height:1250,deviceScaleFactor:1});
await page.setContent(`<html><body style="margin:0;padding:24px;background:#110f0e;display:grid;grid-template-columns:1fr 1fr;gap:20px">${files.map(f=>`<img style="width:100%;border-radius:10px" src="http://127.0.0.1:${port}/${f}">`).join('')}</body></html>`,{waitUntil:'domcontentloaded'});
await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));await page.screenshot({path:join(root,'contact-sheet.png'),fullPage:true});
await page.setViewport({width:1200,height:630,deviceScaleFactor:1});
await page.goto(`http://127.0.0.1:${port}/release-card.html`,{waitUntil:'networkidle0'});
await page.evaluate(()=>document.fonts.ready);
await mkdir(join(root,'../../public/og'),{recursive:true});
await page.screenshot({path:join(root,'../../public/og/product-update-2026-10.png')});
console.log('Rendered 1200×630 release link preview.');
const thread=campaign.thread.map((p,i)=>`POST ${i+1} · ${weighted(p.text)} weighted characters\nIMAGE: ${p.image||'none'}\n\n${p.text}`).join('\n\n---\n\n');
await writeFile(join(root,'thread-en.txt'),thread+'\n');
await writeFile(join(root,'standalone-en.txt'),campaign.standalone.map(p=>`${p.name}\nIMAGES: ${p.images.join(', ')}\n\n${p.text}`).join('\n\n---\n\n')+'\n');
console.log('Validated 8 thread posts and 3 standalone posts (URL-weighted, under 280 characters).');
}finally{if(browser)await browser.close();server.close()}
