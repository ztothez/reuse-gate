import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const output=process.env.EVIDENCE_DIR||'/tmp/reuse-gate-visual/finish/stability-release';fs.mkdirSync(output,{recursive:true});const results=[];
for(let run=1;run<=10;run++){const start=Date.now();const result=spawnSync('npm',['test'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});fs.writeFileSync(`${output}/run-${run}.log`,result.stdout+result.stderr);const count=result.stdout.match(/Tests\s+(\d+) passed/);const row={run,passed:result.status===0,tests:count?Number(count[1]):null,seconds:(Date.now()-start)/1000};results.push(row);fs.writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(row));}if(results.some(r=>!r.passed))process.exitCode=1;
