import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.VERIFY_URL||'http://127.0.0.1:8084';
const output='/tmp/reuse-gate-visual/finish/screens';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch();const evidence=[];
async function capture(page,name,width){const state=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,rawHeadlines:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim()).filter(t=>/^(SM|OWN|AST|REQ|WI)-[A-Z0-9]+$/.test(t))}));assert(state.document<=state.viewport,`${name} overflow at ${width}`);assert.deepEqual(state.rawHeadlines,[]);await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});evidence.push({name,width,...state,path:`${output}/${name}-${width}.png`});}
try{for(const width of [320,375,768,1280]){const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/approve',route=>route.abort());
 for(const [name,path]of Object.entries({home:'/',requests:'/requests',item:'/requests/SAMPLE-07',approvals:'/approvals?id=WI-31CF5342',overview:'/overview',radar:'/radar',log:'/log',admin:'/admin',evaluation:'/evaluation',asset:'/assets/AST-0009',new:'/requests?create=1'})){
  await page.goto(base+path,{waitUntil:"domcontentloaded"});await page.locator('main h1').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('main [role="status"]')].every(e=>!/^Loading/.test(e.textContent)||!e.checkVisibility()));await page.waitForTimeout(300);await capture(page,name,width);
  if(name==='item')for(const tab of ['Clarification','Gates','Activity']){await page.getByRole('tab',{name:new RegExp('^'+tab)}).click();await capture(page,`item-${tab.toLowerCase()}`,width);}
 }
 await page.goto(base,{waitUntil:"domcontentloaded"});for(const lens of ['Approver','Executive','Admin']){await page.getByRole('button',{name:lens,exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('main [role="status"]')].every(e=>!/^Loading/.test(e.textContent)||!e.checkVisibility()));await page.waitForTimeout(300);await capture(page,`home-${lens.toLowerCase()}`,width);}
 assert.deepEqual(errors,[]);await page.close();
 const voice=await browser.newPage({viewport:{width,height:900}});await voice.addInitScript(()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  window.MediaRecorder=class{mimeType='audio/webm;codecs=opus';state='inactive';ondataavailable=null;onstop=null;start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic browser test audio'])});this.onstop?.();}};
 });
 let release;let fail=false;let calls=0;
 await voice.route('**/transcribe',async route=>{calls++;assert.equal(route.request().method(),'POST');assert.equal(route.request().headers()['content-type'],'audio/webm;codecs=opus');await new Promise(resolve=>{release=resolve;});await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{code:'permission_missing',error:'not configured'}:{text:'A request from the synthetic voice test',language:'en'})});});
 await voice.goto(base+'/requests?create=1',{waitUntil:'domcontentloaded'});await voice.getByRole('button',{name:'Record request'}).waitFor();await voice.waitForTimeout(1200);
 const initialVoiceUrl=voice.url();let creates=0;voice.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/requests')creates++;});
 const stored=await voice.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)}));
 await voice.getByRole('button',{name:'Record request'}).focus();await voice.keyboard.press('Enter');await voice.getByRole('button',{name:'Stop recording'}).waitFor();await capture(voice,'voice-recording',width);
 assert(await voice.getByLabel('What report do you need?').isEnabled());await voice.getByRole('button',{name:'Stop recording'}).click();await voice.getByRole('button',{name:'Transcribing...'}).waitFor();await capture(voice,'voice-transcribing',width);
 while(!release)await voice.waitForTimeout(10);release();await voice.getByLabel('Review transcript').waitFor();await capture(voice,'voice-review',width);
 await voice.getByLabel('Review transcript').fill('An edited voice draft');await voice.keyboard.press('Tab');assert.equal(await voice.evaluate(()=>document.activeElement.textContent.trim()),'Use this text');await voice.keyboard.press('Enter');assert.equal(await voice.getByLabel('What report do you need?').inputValue(),'An edited voice draft');assert.equal(voice.url(),initialVoiceUrl);assert.equal(creates,0);
 fail=true;release=undefined;await voice.getByRole('button',{name:'Record request'}).click();await voice.getByRole('button',{name:'Stop recording'}).click();while(!release)await voice.waitForTimeout(10);release();await voice.getByRole('alert').waitFor();await capture(voice,'voice-error',width);
 assert.match(await voice.getByRole('alert').textContent(),/Voice input is not available right now, please type instead/);assert.deepEqual(await voice.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)})),stored);assert.equal(calls,2);await voice.close();
 }
 await fs.writeFile(`${output}/index.json`,JSON.stringify(evidence,null,2));await fs.writeFile(`${output}/index.md`,'# Finish screenshots\n\n'+evidence.map(r=>`- [${r.name}, ${r.width}px](${r.path})`).join('\n')+'\n');console.log(JSON.stringify({screenshots:evidence.length,overflow:0,voiceKeyboardAndStorageChecks:true,index:`${output}/index.md`}));
}finally{await browser.close();}
