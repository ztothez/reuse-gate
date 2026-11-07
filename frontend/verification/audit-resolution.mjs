import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VERIFY_URL || 'http://127.0.0.1:8084';
const output = process.env.EVIDENCE_DIR || '/tmp/reuse-gate-visual/finish/audit-resolution';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const widths = { phone320:320, phone375:375, tablet:768, desktop:1280 };
const paths = { requests:'/requests', item:'/requests/SAMPLE-07', approvals:'/approvals', overview:'/overview', populated_review:'/approvals?id=WI-31CF5342', radar:'/radar', voice:'/requests?create=1', evaluation:'/evaluation' };
try {
 for (const [viewport,width] of Object.entries(widths).filter(([name])=>!process.env.VERIFY_VIEWPORT||name===process.env.VERIFY_VIEWPORT)) for (const [journey,route] of Object.entries(paths).filter(([name])=>!process.env.VERIFY_JOURNEY||name===process.env.VERIFY_JOURNEY)) {
  const page=await browser.newPage({ viewport:{width,height:900} });
  await page.goto(base+route,{waitUntil:"domcontentloaded"}); await page.locator('main h1').waitFor();
  await page.waitForTimeout(1500);
  const expected=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex],summary')).filter(e=>!e.disabled&&e.tabIndex>=0&&e.checkVisibility()&&e.getBoundingClientRect().width>0&&(!e.closest('details:not([open])')||e.closest('summary'))).map((e,i)=>{e.dataset.finishFocus=String(i);return {index:i,name:e.getAttribute('aria-label')||e.labels?.[0]?.textContent.trim()||e.textContent.trim().slice(0,80)||e.id,tag:e.tagName,type:e.type||''};}));
  assert(expected.length>0);
  const trace=[];
  await page.locator('[data-finish-focus="0"]').focus();
  for(const control of expected){
   let actual=await page.evaluate(()=>document.activeElement.dataset.finishFocus);
   let repeats=0;
   while(actual!==String(control.index)&&repeats<4){
    const previous=expected[control.index-1];
    assert(previous&&['date','time','datetime-local'].includes(previous.type),`Unexpected focus order ${journey}/${viewport}: expected ${control.index}, got ${actual}`);
    assert.equal(actual,String(previous.index));
    await page.keyboard.press('Tab'); repeats++;
    actual=await page.evaluate(()=>document.activeElement.dataset.finishFocus);
   }
   assert.equal(actual,String(control.index),`Focus order ${journey}/${viewport}`);
   const visible=await page.evaluate(()=>{
    const e=document.activeElement,r=e.getBoundingClientRect();let b={left:Math.max(0,r.left),right:Math.min(innerWidth,r.right),top:Math.max(0,r.top),bottom:Math.min(innerHeight,r.bottom)};
    for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(s.overflowX!=='visible'){b.left=Math.max(b.left,r.left);b.right=Math.min(b.right,r.right);}if(s.overflowY!=='visible'){b.top=Math.max(b.top,r.top);b.bottom=Math.min(b.bottom,r.bottom);}}
    const hit=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);
    const style=getComputedStyle(e);return {box:b,visible:b.right>b.left&&b.bottom>b.top,unoccluded:!!hit&&(e.contains(hit)||hit.contains(e)),outline:style.outlineStyle,outlineWidth:style.outlineWidth};
   });
   if(!visible.visible||!visible.unoccluded){await page.screenshot({path:path.join(output,`failure-${journey}-${viewport}.png`),fullPage:true});}
   assert(visible.visible&&visible.unoccluded,`Focus hidden or occluded: ${journey}/${viewport}/${control.name}: ${JSON.stringify(visible)}`);
   trace.push({...control,...visible,nativeSubfieldRepeats:repeats});
   await page.keyboard.press('Tab');
  }
  if(journey==='item'){
   await page.getByRole('tab',{name:'Overview',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:/Clarification/}).getAttribute('aria-selected'),'true');
  }
  await page.screenshot({path:path.join(output,`${journey}-${viewport}.png`),fullPage:true});
  results.push({journey,viewport,width,expectedOrder:expected,trace,passed:true,screenshot:`${journey}-${viewport}.png`});
  await page.close();
 }
 for(const viewport of ['tablet','desktop']){
  const page=await browser.newPage({viewport:{width:widths[viewport],height:900}});
  await page.goto(base+'/radar',{waitUntil:'domcontentloaded'});await page.locator('main h1').waitFor();await page.waitForTimeout(1500);
  const boxes=await page.evaluate(()=>Array.from(document.querySelectorAll('main a[href],main button,main [tabindex="0"]')).map((e,index)=>{
   const r=e.getBoundingClientRect();let box={left:r.left+scrollX,right:r.right+scrollX,top:r.top+scrollY,bottom:r.bottom+scrollY};
   for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(s.overflowX!=='visible'){box.left=Math.max(box.left,r.left+scrollX);box.right=Math.min(box.right,r.right+scrollX);}if(s.overflowY!=='visible'){box.top=Math.max(box.top,r.top+scrollY);box.bottom=Math.min(box.bottom,r.bottom+scrollY);}}
   e.dataset.finishBox=String(index);return {index,name:e.getAttribute('aria-label')||e.textContent.trim().slice(0,80),tag:e.tagName,box,ancestors:Array.from(document.querySelectorAll('main [tabindex="0"]')).filter(p=>p!==e&&p.contains(e)).map(p=>p.getAttribute('aria-label'))};
  }));
  const collisions=await page.evaluate((boxes)=>{const found=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];const ae=document.querySelector(`[data-finish-box="${a.index}"]`),be=document.querySelector(`[data-finish-box="${b.index}"]`);if(ae.contains(be)||be.contains(ae))continue;const w=Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left),h=Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top);if(w>4&&h>4)found.push({a:a.index,b:b.index,width:w,height:h});}return found;},boxes);
  assert.deepEqual(collisions,[],`Painted Radar overlap ${viewport}`);
  await page.evaluate((boxes)=>{for(const {box,index} of boxes){if(box.right<=box.left||box.bottom<=box.top)continue;const d=document.createElement('div');Object.assign(d.style,{position:'absolute',left:`${box.left}px`,top:`${box.top}px`,width:`${box.right-box.left}px`,height:`${box.bottom-box.top}px`,border:'1px solid var(--primary)',pointerEvents:'none',zIndex:'10000',fontSize:'var(--type-meta)',color:'var(--primary)'});d.textContent=String(index);document.body.append(d);}},boxes);
  await page.screenshot({path:path.join(output,`radar-bounds-${viewport}.png`),fullPage:true});
  results.push({journey:'radar',viewport,boxes,collisions,passed:true,screenshot:`radar-bounds-${viewport}.png`});await page.close();
 }
 await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({checks:results.length,passed:results.every(r=>r.passed),evidence:path.join(output,'evidence.json')}));
}finally{await browser.close();}
