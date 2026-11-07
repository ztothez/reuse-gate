// Exercise the real browser encoder with a synthetic microphone and intercepted API responses.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mock = JSON.parse(await fs.readFile(new URL('../src/data/mock_api.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage();
let evidence;
try {
 await page.route('http://127.0.0.1:8001/requests', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.work_items.list) }));
 await page.route('http://127.0.0.1:8001/transcribe', async route => {
  const body = route.request().postDataBuffer();
  const mime = route.request().headers()['content-type'];
  assert(mime.startsWith('audio/webm')); assert(body.length > 0);
  evidence = { browser: 'Chromium with real MediaRecorder and synthetic microphone', mime, bytes: body.length, containerHeader: body.subarray(0,4).toString('hex'), provider: 'Intercepted test response; no provider call' };
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'Browser audio format checked',language:'en'})});
 });
 await page.goto((process.env.VERIFY_URL || 'http://127.0.0.1:8085') + '/requests?create=1', {waitUntil:'domcontentloaded'});
 await page.getByLabel('What report do you need?').fill('Format verification');
 await page.waitForTimeout(800);
 await page.getByRole('button',{name:'Record request',exact:true}).click();
 await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor();
 await page.waitForTimeout(1200);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.getByLabel('Review transcript').waitFor();
 assert.equal(await page.getByLabel('Review transcript').inputValue(),'Browser audio format checked');
 const output='/tmp/reuse-gate-visual/finish/voice-format';await fs.mkdir(output,{recursive:true});
 await fs.writeFile(`${output}/evidence.json`,JSON.stringify(evidence,null,2));
 await page.screenshot({path:`${output}/review.png`,fullPage:true});
 console.log(JSON.stringify(evidence));
}finally{await browser.close();}
