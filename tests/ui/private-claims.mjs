/** Real React components in Chromium; chain/wallet/Convex boundaries are local fixtures.
 * Run: node tests/ui/private-claims.mjs [--red]
 * This isolates permission UX from the app's pre-existing Coinbase build blocker.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { createRequire } from "node:module";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = await mkdtemp(join(tmpdir(), "mimir-private-ui-"));
const creator = "0x00000000000000000000000000000000000000c0";
const alice = "0x00000000000000000000000000000000000000a1";
const bob = "0x00000000000000000000000000000000000000b0";
const vs = "0x0000000000000000000000000000000000000001";
const pool = "0x0000000000000000000000000000000000000002";
const require = createRequire(import.meta.url);
const { parseAbi } = require("viem");
const eventAbi = parseAbi(["event ClaimCreated(uint256 indexed id, address indexed creator, string category)", "event MarketCreated(uint256 indexed id, address indexed creator, uint256 deadline, string category)"]);
const logs = Object.fromEntries(["vs", "pool"].map(kind => [kind, [{ address: kind === "vs" ? vs : pool,
  topics: encodeEventTopics({ abi: eventAbi, eventName: kind === "vs" ? "ClaimCreated" : "MarketCreated", args: { id: 45n, creator } }),
  data: kind === "vs" ? encodeAbiParameters([{ type: "string" }], ["custom"]) : encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [2_000_000_000n, "custom"]),
}]]));
const mocks = {
  "convex/react": `export const useQuery=q=>q==='markets'?[]:0; export const useMutation=()=>async()=>{};`,
  "convex/_generated/api": `export const api={arc:{openedToday:'openedToday',markets:'markets',poke:0}};`,
  "i18n/navigation": `import React from 'react';export const Link=p=>React.createElement('a',p,p.children);export const useRouter=()=>({push:p=>window.H.route=p});`,
  "next-intl": `export const useLocale=()=>'en';`,
  "components/wallet/WalletFunding": `export default function Funding(){return null}`,
  "components/ui/Modal": `import React from 'react';export default function Modal(p){return p.open?React.createElement('div',{role:'dialog','aria-label':p.title},p.children):null}`,
  "components/arc/NetworkLogos": `import React from 'react';export const ChainPicker=p=>React.createElement('div',null,p.chains.map(id=>React.createElement('button',{key:id,onClick:()=>p.onChange(id)},id)));`,
  "components/arc/arena/AccountGate": `export default function Gate(p){return p.children}`,
  "components/arc/arena/useArcAccount": `import {useEffect,useState} from 'react';export function useArcAccount(chain='base'){const [,bump]=useState(0);useEffect(()=>{const f=()=>bump(n=>n+1);window.H.listeners.add(f);return()=>window.H.listeners.delete(f)},[]);return window.H.account(chain)}`,
  "lib/chains/client": `export const ERC20_ABI=[];export const chainPublicClient=c=>({readContract:a=>window.H.read(c.id,a),getTransactionReceipt:async()=>{if(window.H.failReceipt)throw Error('receipt unavailable');return {logs:window.H.logs[window.H.actions.at(-1)?.market?.kind??'vs']}}});`,
  "lib/chains/registry": `export const MARKET_CHAINS=window.H.registry;export const marketChain=id=>MARKET_CHAINS.chains[id];export const marketContract=(c,k)=>k==='vs'?c.contracts.mimirV3:c.contracts.mimirPool;export const explorerUrl=(c,k,v)=>'https://example.invalid/'+v;`,
};
const privateFile = resolve(repo, "components/arc/arena/PrivateClaimAccess.tsx");
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Create from './components/arc/arena/ArcCreateForm';
import Stake from './components/arc/arena/ArcStakePanel';
import Access from './components/arc/arena/PrivateClaimAccess';
import Share from './components/arc/arena/ShareMarket';
import {useArcAccount} from './components/arc/arena/useArcAccount';
function App(){const account=useArcAccount(window.H.chain);const m=window.H.market;return window.H.mode==='create'?<Create/>:window.H.mode==='stake'?<Stake m={m} mine={[]} account={account}/>:window.H.mode==='manage'?<Access m={m} account={account}/>:<Share chain='base' kind='vs' marketId={45} question='Q?' fresh isPrivate/>}
createRoot(document.getElementById('root')).render(<App/>);`;
const outfile = join(root, "bundle.js");
await build({ stdin: { contents: entry, loader: "tsx", resolveDir: repo }, outfile, bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: resolve(repo, "tsconfig.json"), define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "local-boundaries", setup(b) {
  b.onResolve({ filter: /.*/ }, args => {
    let path = args.path;
    if (path.startsWith("@/")) path=path.slice(2);
    else if (path.startsWith(".")) path=resolve(dirname(args.importer || resolve(repo,"entry.tsx")),path).slice(repo.length+1);
    path=path.replace(/\.(tsx?|jsx?)$/,"");
    if(path==='components/arc/arena/PrivateClaimAccess'&&!existsSync(privateFile)) return {path:'absent',namespace:'fixture'};
    if(mocks[path]) return {path,namespace:'fixture'};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='absent'?`export default function Missing(){return null}`:mocks[args.path],resolveDir:repo,loader:'jsx'}));
} }] });
function fixture(mode, wallet) {
  const h={mode,wallet,chain:'base',creator,alice,bob,actions:[],permissions:{},logs,route:null,readFailure:false,holdReads:false,pending:[],failSend:false};
  return `window.H=${JSON.stringify(h)};
  H.listeners=new Set();H.notify=()=>H.listeners.forEach(f=>f());H.switchWallet=w=>{H.wallet=w;H.notify()};
  H.registry={defaultChain:'base',enabled:['base','arc'],chains:Object.fromEntries(['base','arc'].map(id=>[id,{id,chainId:id==='base'?84532:5042002,label:id,name:id,enabled:true,gas:{symbol:id==='base'?'ETH':'USDC',decimals:18},usdc:{kind:id==='base'?'erc20':'native',decimals:id==='base'?6:18,permit:true,address:'${vs}'},contracts:{mimirV3:'${vs}',mimirPool:'${pool}',mimirFees:null,minStakeWei:10000000000000000n}}]))};
  H.market={kind:'vs',marketId:45,creator:'${creator}',question:'Will this event happen?',category:'custom',status:'open',isPrivate:true,stakeA:'10000000000000000000',stakeB:'0',labelA:'Yes',labelB:'No',deadline:Math.floor(Date.now()/1000)+86400};
  H.inviteReads=0;H.read=async(chain,a)=>{if(a.functionName==='invited'){H.inviteReads++;if(H.readFailure)throw Error('legacy or unavailable');if(H.holdReads)return new Promise(r=>H.pending.push(r));if(a.address!=='${vs}')return false;return Boolean(H.permissions[chain+':'+a.args[0]+':'+a.args[1].toLowerCase()])}if(a.functionName==='paused')return false;return 0n};
  H.account=chain=>({chain,chainConfig:H.registry.chains[chain],address:H.wallet,session:{address:H.wallet},balance:100000000000000000000n,gas:1000000000000000000n,entryBps:0,reload:async()=>{},sendAction:async a=>{H.actions.push(a);if(H.failSend)throw Object.assign(Error('User rejected'),{code:4001});if(a.type==='invite')a.accounts.forEach(w=>H.permissions[chain+':'+a.marketId+':'+w.toLowerCase()]=a.allowed);return{txHash:'0x01',txHashes:['0x01']}}});`;
}
const server = createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(outfile));return}
  const wallet=url.searchParams.get('wallet')==='alice'?alice:creator;
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script>${fixture(url.searchParams.get('mode')??'create',wallet)}</script><script src="/bundle.js"></script></body></html>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const port=server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PRIVATE_UI_BROWSER?{executablePath:process.env.PRIVATE_UI_BROWSER}:{})});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)});
async function go(mode,wallet){assert.deepEqual(errors,[]);errors.length=0;await page.goto(`http://127.0.0.1:${port}/?mode=${mode}${wallet?'&wallet='+wallet:''}`);}
async function expectVisible(locator){await locator.waitFor({state:'visible',timeout:5000})}
async function fillCreate(){await page.getByLabel('Question',{exact:true}).fill('Will this event happen tomorrow?');await page.getByLabel('Resolution source',{exact:true}).fill('https://example.com');}
try {
  await go('create');
  await expectVisible(page.getByRole('heading',{name:'Open a market',exact:true}));
  assert.deepEqual(errors,[]);
  await page.getByRole('checkbox',{name:/Private.*approved wallets/i}).check({timeout:3000});
  console.log('PASS private creation control is available');
  if(process.argv.includes('--red')) process.exitCode=0;
  else {
    await fillCreate();
    await page.getByRole('button',{name:/Open with/}).click();
    await page.waitForFunction(()=>H.route?.includes('/vs/45'));
    assert.equal(await page.evaluate(()=>H.actions.length),1);
    assert.equal(await page.evaluate(()=>H.actions[0].market.isPrivate),true);
    console.log('PASS private create funds once and leaves approvals to the detail page');

    await go('create');await fillCreate();await page.evaluate(()=>H.failReceipt=true);
    await page.getByRole('checkbox',{name:/Private.*approved wallets/i}).check();
    await page.getByRole('button',{name:/Open with/}).click();
    await expectVisible(page.getByText(/do not create it again/));
    assert.equal(await page.getByRole('button',{name:'Creation confirmed',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>H.actions.length),1);
    console.log('PASS a confirmed creation with unreadable details cannot be submitted twice');

    await go('create');await page.getByRole('checkbox',{name:/Private.*approved wallets/i}).check();
    await fillCreate();await page.getByRole('radio',{name:/Two-sided pool/}).click();
    await page.getByRole('button',{name:/Open with/}).click();
    await page.waitForFunction(()=>H.route?.includes('/pool/45'));
    assert.equal(await page.evaluate(()=>H.actions[0].market.isPrivate),false);
    console.log('PASS switching to a pool preserves public creation');

    await go('create');await page.evaluate(()=>H.readFailure=true);await fillCreate();
    await page.getByRole('checkbox',{name:/Private.*approved wallets/i}).check();
    await expectVisible(page.getByText(/wallet permissions.*unavailable/i));
    assert.equal(await page.getByRole('button',{name:/Open with/}).isDisabled(),true);
    console.log('PASS legacy/unreadable private deployments cannot take creation funds');

    await go('manage');await page.getByLabel('Wallet addresses',{exact:true}).fill(alice);
    await page.waitForFunction(()=>!document.querySelector('button[data-private-approve]')?.disabled);
    await page.evaluate(()=>H.failSend=true);await page.getByRole('button',{name:'Approve wallets',exact:true}).click();
    await expectVisible(page.getByText(/cancelled in your wallet/));
    assert.equal(await page.evaluate(()=>H.actions.filter(a=>a.type==='create').length),0);
    await page.evaluate(()=>H.failSend=false);await page.getByRole('button',{name:'Approve wallets',exact:true}).click();
    await expectVisible(page.getByText('Approved',{exact:true}));
    await page.getByRole('button',{name:'Revoke wallets',exact:true}).click();
    await expectVisible(page.getByText('Not approved',{exact:true}));
    await page.evaluate(w=>H.switchWallet(w),bob);
    await page.getByRole('button',{name:'Approve wallets',exact:true}).waitFor({state:'detached'});
    console.log('PASS creator can approve/revoke, recover from rejection, and never recreate a market');

    await go('stake','alice');await expectVisible(page.getByText(/has not approved this wallet/i));
    assert.equal(await page.getByRole('button',{name:/Challenge with/}).isDisabled(),true);
    await page.evaluate(()=>{H.permissions['base:45:'+H.alice]=true;window.dispatchEvent(new Event('focus'))});
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Challenge with'))?.disabled);
    await page.evaluate(()=>H.permissions['base:45:'+H.alice]=false);
    await page.getByRole('button',{name:/Challenge with/}).click();
    await expectVisible(page.getByText(/has not approved this wallet/i));
    assert.equal(await page.evaluate(()=>H.actions.length),0);
    await page.evaluate(()=>{H.readFailure=true;window.dispatchEvent(new Event('focus'))});
    await expectVisible(page.getByText(/could not verify.*approval/i));
    console.log('PASS stake gate blocks outsiders, read errors and a grant revoked immediately before send');

    await go('stake','alice');await page.evaluate(()=>{H.holdReads=true;window.dispatchEvent(new Event('focus'))});
    await page.waitForFunction(()=>H.pending.length>0);
    await page.evaluate(()=>{H.holdReads=false;H.switchWallet(H.bob)});
    await expectVisible(page.getByText(/has not approved this wallet/i));
    await page.evaluate(()=>H.pending.splice(0).forEach(r=>r(true)));
    await expectVisible(page.getByText(/has not approved this wallet/i));
    assert.equal(await page.getByRole('button',{name:/Challenge with/}).isDisabled(),true);
    console.log('PASS a delayed old-wallet approval cannot authorize the new wallet');

    for(const context of ['claim','chain','contract']) {
      await go('stake','alice');await page.evaluate(()=>{H.holdReads=true;window.dispatchEvent(new Event('focus'))});
      await page.waitForFunction(()=>H.pending.length>0);
      await page.evaluate(context=>{H.holdReads=false;if(context==='claim')H.market.marketId=46;if(context==='chain')H.chain='arc';if(context==='contract')H.registry.chains.base={...H.registry.chains.base,contracts:{...H.registry.chains.base.contracts,mimirV3:H.bob}};H.notify()},context);
      await expectVisible(page.getByText(/has not approved this wallet/i));
      await page.evaluate(()=>H.pending.splice(0).forEach(r=>r(true)));
      assert.equal(await page.getByRole('button',{name:/Challenge with/}).isDisabled(),true);
    }
    console.log('PASS delayed reads cannot authorize a different claim, chain or contract');

    await go('stake','alice');await expectVisible(page.getByText(/has not approved this wallet/i));
    await page.evaluate(()=>{H.readFailure=true;H.inviteReads=0;H.market.isPrivate=false;H.notify()});
    await page.getByRole('button',{name:/Challenge with/}).click();
    assert.equal(await page.evaluate(()=>H.actions.filter(a=>a.type==='stake').length),1);
    assert.equal(await page.evaluate(()=>H.inviteReads),0);
    console.log('PASS public staking does not depend on private permission reads');

    await go('stake','alice');await expectVisible(page.getByText(/has not approved this wallet/i));
    await page.evaluate(()=>{H.permissions['base:45:'+H.alice]=true;window.dispatchEvent(new Event('focus'))});
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Challenge with'))?.disabled);
    await page.getByRole('button',{name:/Challenge with/}).click();
    await expectVisible(page.getByText(/Only creator-approved wallets can join this private claim/));
    const privateIntent = new URL(await page.getByRole('link',{name:'Share on X',exact:true}).getAttribute('href'));
    assert.match(privateIntent.searchParams.get('text'),/Only creator-approved wallets can join/);
    assert.doesNotMatch(privateIntent.searchParams.get('text'),/Think I'm wrong\? Take the other side/);
    console.log('PASS private post-stake sharing keeps the approval restriction explicit');

    await go('share');await expectVisible(page.getByText(/Only approved wallets can join/i));
    assert.equal(await page.getByText(/anyone with the link can take a side/i).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS private sharing explains restricted entry');

    const jsonUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401234567#mimir=json:eq:true:header.competitions[0].status.type.completed';
    await go('create');await fillCreate();
    await page.getByLabel('Resolution source',{exact:true}).fill(jsonUrl);
    await expectVisible(page.getByRole('note').filter({hasText:/Custom JSON rule ignored/}));
    await page.getByRole('button',{name:/Open with/}).click();
    await page.waitForFunction(()=>H.route?.includes('/vs/45'));
    assert.equal(await page.evaluate(()=>H.actions[0].market.resolutionUrl),jsonUrl);
    console.log('PASS JSON notice appears before creation without restricting free-form input');

    await go('stake','alice');
    await page.evaluate(url=>{H.market.isPrivate=false;H.market.resolutionUrl=url;H.notify()},jsonUrl);
    await expectVisible(page.getByRole('note').filter({hasText:/Custom JSON rule ignored/}));
    await page.getByRole('button',{name:/Challenge with/}).click();
    assert.equal(await page.evaluate(()=>H.actions.filter(a=>a.type==='stake').length),1);
    console.log('PASS JSON notice appears before a challenger stakes');
  }
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}
