// Browser-only test transport. Never enables approvals in the application's offline mode.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const mock=JSON.parse(await fs.readFile(new URL('../src/data/mock_api.json',import.meta.url),'utf8'));
const output='/tmp/reuse-gate-visual/finish/mock-flow';await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900}});
const item=structuredClone(mock.work_items.detail['SAMPLE-07']);item.request_id='WI-FINISH-TEST';item.result.request_id=item.request_id;item.origin='user';item.requester='Frontend transport test';item.activity=[];
const calls=[];let log=[];let unhandledWrites=0;
const timestamp=()=>new Date().toISOString();
const original=structuredClone(item.result.pipeline.find(p=>p.stage==='Gates').output);
const snapshot=(gates,owner=null)=>({...gates,owner,as_of:'2026-11-07',passing:gates.gates.filter(g=>g.passed).length,total:gates.gates.length,failing:gates.gates.filter(g=>!g.passed).map(g=>g.gate)});
function row(){return {...mock.work_items.list.find(r=>r.request_id==='SAMPLE-07'),request_id:item.request_id,text:item.text,status:item.status,origin:'user',owner:item.decision?.owner||null,created:item.created,updated:item.updated,open_questions:item.status==='clarifying'?1:0,gates_passed:item.remediation?.passed_after??false};}
try{
 await page.route('**/*',route=>{const r=route.request();if(r.method()==='POST'&&['/requests','/approve','/remediate'].includes(new URL(r.url()).pathname)){unhandledWrites++;return route.abort();}return route.continue();});
 await page.route('http://127.0.0.1:8001/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();const body=method==='POST'?request.postDataJSON():null;
  calls.push({path:url.pathname,method,...(body?{body}: {})});
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(method==='GET'){
   if(url.pathname==='/requests')return send([row(),...mock.work_items.list]);
   if(url.pathname==='/requests/'+item.request_id)return send(item);
   if(url.pathname.startsWith('/requests/'))return send(mock.work_items.detail[decodeURIComponent(url.pathname.split('/').at(-1))]||item);
   if(url.pathname==='/owners')return send(mock.owners);
   if(url.pathname==='/radar')return send(mock.radar);
   if(url.pathname==='/evaluation')return send(mock.evaluation);
   if(url.pathname==='/log')return send(log);
   if(url.pathname==='/health')return send({ok:true,assets:360});
  }
  if(url.pathname==='/requests'&&method==='POST'){
   if(body.request_id){assert.equal(body.request_id,item.request_id);assert(body.rounds.length>0);assert.equal(body.answers.at(-1).answer,'yes');item.status='awaiting_approval';item.result.answers=body.answers;item.result.intent.questions=[];item.result.intent.clarifications=[];item.rounds=structuredClone(body.rounds);item.rounds[0].answers=body.answers;item.rounds[0].intent_after=item.rounds[0].intent;item.result.loop={...item.result.loop,status:'clear',open_fields:[],rounds_used:1,rounds:item.rounds};item.activity.push({event:'rechecked',time:timestamp(),actor:'Requester',detail:'Market confirmed in test transport'});}
   else{assert.equal(body.text,item.text);item.created=timestamp();item.rounds=item.result.loop.rounds;item.activity.push({event:'created',time:timestamp(),actor:'Requester',detail:'Synthetic browser request'});}
   item.updated=timestamp();return send({request_id:item.request_id,status:item.status,result:item.result});
  }
  if(url.pathname==='/remediate'){
   assert.equal(body.request_id,item.request_id);assert.equal(body.remediations[0].target,'SM-065');assert.equal(body.remediations[0].owner_id,'OWN-039');
   const owner=mock.owners.find(o=>o.owner_id==='OWN-039');const after=structuredClone(original);after.passed=true;after.gates=after.gates.map(g=>({...g,passed:true,detail:g.passed?g.detail:'Confirmed by synthetic test transport'}));
   item.remediation={applied:'simulated',estate_snapshot:mock.evaluation.estate_snapshot,request_id:item.request_id,intent_source:'rules',as_of:'2026-11-07',decision:{action:'new_build',target:null,build_on:'SM-065'},remediations:[{type:'assign_owner',target:'SM-065',target_table:'Semantic_Models',owner_id:owner.owner_id,owner_name:owner.owner_name,from_owner_id:'OWN-037',from_status:'inactive',citations:['Owners:OWN-039']}],before:{owner:null,gates:snapshot(original)},after:{owner:owner.owner_name,gates:snapshot(after,owner.owner_name)},diff:original.gates.filter(g=>!g.passed).map(g=>({gate:g.gate,before:false,after:true,detail_before:g.detail,detail_after:'Confirmed by synthetic test transport'})),fixed:original.gates.filter(g=>!g.passed).map(g=>g.gate),still_failing:[],passed_before:false,passed_after:true};
   item.activity.push({event:'remediation_simulated',time:timestamp(),actor:'Approver',detail:'Simulated, not applied'});return send(item.remediation);
  }
  if(url.pathname==='/approve'){
   assert.equal(body.request_id,item.request_id);assert(body.rounds.length>0);assert.equal(body.remediations[0].owner_id,'OWN-039');assert.equal(item.status,'awaiting_approval');assert.equal(item.remediation.passed_after,true);
   item.status='approved';item.updated=timestamp();item.decision={registered_id:'DEMO-FINISH',decision:'approve',approver:body.approver,owner:body.owner,review_by:body.review_by,time:timestamp(),gates_passed:true,estate_snapshot:mock.evaluation.estate_snapshot};item.activity.push({event:'approved',time:timestamp(),actor:body.approver,detail:'Synthetic demo response, no API approval sent'});
   log=[{...item.decision,mode:'demo',request_id:item.request_id,text:item.text,action:'new_build',target:'SM-065',record:{estate_snapshot:mock.evaluation.estate_snapshot,request_text:item.text,approver:body.approver,owner:body.owner,review_by:body.review_by,decision:'approve',rounds:item.rounds,intent:item.result.intent,recommendation:item.result.recommendation,gates:{before_remediation:item.remediation.before.gates,at_approval:item.remediation.after.gates},remediation:item.remediation,note:'Synthetic frontend browser transport. No approval was sent to an API.'}}];
   return send({ok:true,registered_id:'DEMO-FINISH',mode:'demo'});
  }
  if(url.pathname==='/spec')return send({spec:item.result.pipeline.find(p=>p.stage==='Spec').output,gates:item.remediation?.after.gates||original});
  return send({error:'No test fixture for endpoint'},404);
 });
 await page.goto((process.env.VERIFY_URL||'http://127.0.0.1:8084')+'/requests?create=1');await page.getByLabel('What report do you need?').fill(item.text);await page.getByRole('button',{name:'Create request',exact:true}).click();await page.waitForURL('**/requests/'+item.request_id);
 await page.getByRole('tab',{name:/Clarification/}).click();await page.getByLabel('Your answer').fill('yes');await page.getByRole('button',{name:'Send answer',exact:true}).click();await page.getByRole('link',{name:'Review for approval',exact:true}).click();
 await page.getByRole('combobox',{name:/Choose an active owner/}).selectOption('OWN-039');await page.getByLabel('Approver name').fill('Frontend test approver');await page.getByRole('button',{name:'Recheck gates (simulation)',exact:true}).click();await page.getByText('All gates pass in this simulation.').waitFor();assert.equal(item.remediation.before.gates.passing,5);assert.equal(item.remediation.after.gates.passing,7);
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('heading',{name:'Decision recorded',exact:true}).waitFor();
 await page.goto((process.env.VERIFY_URL||'http://127.0.0.1:8084')+'/requests/'+item.request_id);await page.getByRole('tab',{name:'Decision record',exact:true}).click();await page.getByRole('region',{name:'Before remediation',exact:true}).waitFor();assert.match(await page.getByRole('region',{name:'Before remediation',exact:true}).innerText(),/5 of 7/);assert.match(await page.getByRole('region',{name:'At approval',exact:true}).innerText(),/7 of 7/);await page.getByText('demo',{exact:true}).waitFor();
 for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${output}/record-${width}.png`,fullPage:true});}
 await page.goto((process.env.VERIFY_URL||'http://127.0.0.1:8084')+'/evaluation');await page.getByText('93.7%',{exact:true}).waitFor();assert.equal(unhandledWrites,0);
 const result={transport:'Browser-intercepted local fixture API; no server writes',created:true,clarified:true,simulated:{before:5,after:7},approvedDemoResponse:true,savedRecordOpened:true,evaluationOpened:true,unhandledWrites,activity:item.activity.map(a=>a.event),calls};await fs.writeFile(`${output}/evidence.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,calls:result.calls.length}));
}finally{await browser.close();}
