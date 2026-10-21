import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonReplacementService, validatePersonOptions } from './person-replacement.mjs';
import { buildWanEditPayload, normalizeWanEditTask } from './wan-scene-edit.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'wan-edit-test-'));
const db = new DatabaseSync(path.join(root, 'test.sqlite'));
const posts = [], queries = [], tasks = new Map();
let failQuery = false, failPost = false, rejectPost = false, failTask = false, duration = 8;
const config = {mediaKey:'mask-key',seedanceKey:'',wanKey:'wan-key',mediaBase:'https://mask.test',wanBase:'https://workspace.cn-beijing.maas.aliyuncs.com'};
const deps = {getDb:()=>db,root, getConfig:()=>config,
  probe:async()=>({width:1280,height:720,fps:30,durationSeconds:duration}),
  exec:async(cmd,args)=> { if(cmd==='ffmpeg') await writeFile(args.at(-1),'silent-result'); return {stdout:JSON.stringify({streams:[{codec_type:'audio'}]})}; },
  fetchTask:async()=>{throw new Error('Wan must not poll Seedance');},
  fetch:async(url, options={})=>{
    if(options.method==='POST') {
      const body = JSON.parse(options.body); posts.push({url,body,headers:options.headers});
      if(url.includes('face-blur')) return Response.json({task_id:'mask-'+posts.length});
      const id='wan-'+posts.length; tasks.set(id,{body});
      if(failPost) throw new Error('timeout');
      if(rejectPost) return Response.json({code:'InvalidParameter',message:'bad input'});
      return Response.json({output:{task_id:id,task_status:'PENDING'}});
    }
    if(url.includes('/api/v1/tasks/')) {
      queries.push({url,headers:options.headers});
      if(url.startsWith(config.mediaBase)) return Response.json({data:{status:'completed',result:{video_url:'https://files.test/masked.mp4'}}});
      if(failQuery) throw new Error('temporary unavailable');
      const id=url.split('/').at(-1), entry=tasks.get(id);
      return Response.json({output:{task_id:id,task_status:failTask?'FAILED':'SUCCEEDED',message:failTask?'mock failed':'',orig_prompt:entry?.body.input.prompt,submit_time:new Date().toISOString(),video_url:'https://files.test/generated.mp4'},usage:{SR:Number(entry?.body.parameters.resolution.slice(0,-1))}});
    }
    return new Response('video-bytes');
  }};
let service=createPersonReplacementService(deps);
const opts=(extra={})=>({editVersion:'2',model:'wan3.0-video',creationRequestId:crypto.randomUUID(),prompt:'',audioMode:'preserve',files:[new File(['source'],'clip.mp4',{type:'video/mp4'}),new File(['art'],'牡丹.jpg',{type:'image/jpeg'})],...extra});
async function drive(id,target='completed') {for(let i=0;i<12;i++){service.stop();await service.tick();const job=service.get(id);if([target,'failed','awaiting_confirmation'].includes(job.stage))return job;}assert.fail('unfinished');}
const count=()=>posts.filter(p=>p.body.model==='wan3.0-video').length;
const masks=()=>posts.filter(p=>p.url.includes('face-blur')).length;
try {
  assert.equal(validatePersonOptions(opts()).resolution,'480p');
  for(const resolution of ['480p','720p','1080p'])assert.equal(validatePersonOptions(opts({resolution})).resolution,resolution);
  assert.throws(()=>validatePersonOptions(opts({resolution:'4k'})),/不支持/);
  assert.throws(()=>validatePersonOptions(opts({model:'doubao-seedance-2-0-260128',resolution:'1080p'})),/不支持/);
  for(const mode of ['preserve','rewrite','new-voice','silent']) {
    const payload=buildWanEditPayload({resolution:'480p',audioMode:mode,sourceHasAudio:true},'prompt','https://video','https://image');
    assert.equal(payload.parameters.audio,mode!=='silent');
  }
  assert.equal(buildWanEditPayload({resolution:'480p',audioMode:'preserve',sourceHasAudio:false},'p','https://v').parameters.audio,false);
  const body=opts(), first=await service.create(body,'https://app.test','deviceA');
  const completed=await drive(first.id); assert.equal(completed.stage,'completed',completed.error);
  assert.equal(completed.resolution,'480p'); assert.equal(completed.hasProductReference,true);
  const request=posts.find(p=>p.body.model==='wan3.0-video');
  assert.match(request.url,/workspace.cn-beijing.maas.aliyuncs.com\/api\/v1\/services/);
  assert.equal(request.headers.Authorization,'Bearer wan-key'); assert.equal(request.headers['X-DashScope-Async'],'enable');
  assert.equal(request.body.callback_url,undefined); assert.equal(request.body.content,undefined);
  assert.deepEqual(request.body.parameters,{resolution:'480P',ratio:'adaptive',duration:-1,audio:true,prompt_extend:false,watermark:false});
  assert.deepEqual(request.body.input.media.map(m=>m.type),['reference_video','reference_image']);
  assert.match(request.body.input.media[0].url,/masked.mp4$/); assert.match(request.body.input.media[1].url,/product.jpg$/);
  assert.match(request.body.input.prompt,/默认清除原片叠加水印/); assert.match(request.body.input.prompt,/打码/);
  assert.ok(!JSON.stringify(request).includes('source.mp4'));
  assert.ok(queries.some(q=>q.url.startsWith(config.wanBase)&&q.headers.Authorization==='Bearer wan-key'));
  const final=await service.resultFile(first.id,'deviceA'); assert.equal(String(await readFile(final.path)),'video-bytes');
  service.stop();service=createPersonReplacementService(deps);
  const before=count(); assert.equal((await service.create(body,'https://app.test','deviceA')).id,first.id);assert.equal(count(),before);
  assert.equal(service.get(first.id,'deviceB'),null);
  const pending=await service.create(opts({resolution:'1080p',faceMode:'no-visible-face',files:[new File(['source'],'clip.mp4',{type:'video/mp4'})]}),'https://app.test');
  const previousMasks=masks(); failQuery=true;
  await service.tick();await service.tick();service.stop();
  const submittedCount=count();service.stop();service=createPersonReplacementService(deps);
  await service.tick();service.stop();assert.equal(count(),submittedCount,'GET retry never repeats a paid POST');
  failQuery=false; assert.equal((await drive(pending.id)).stage,'completed');
  assert.equal(posts.at(-1).body.parameters.resolution,'1080P');assert.equal(masks(),previousMasks);
  assert.equal(posts.at(-1).body.input.media.length,1,'reference image remains optional');
  const failing=await service.create(opts(),'https://app.test');failTask=true;
  assert.equal((await drive(failing.id)).stage,'failed');
  const beforeRetryMasks=masks();failTask=false;service.retry(failing.id);assert.equal((await drive(failing.id)).stage,'completed');assert.equal(masks(),beforeRetryMasks);
  const uncertainBody=opts(), uncertain=await service.create(uncertainBody,'https://app.test');failPost=true;
  const unknown=await drive(uncertain.id);assert.equal(unknown.stage,'awaiting_confirmation');assert.equal(unknown.awaitingNotification,false);
  assert.match(unknown.notice,/阿里云/);assert.ok(!unknown.notice.includes('火山'));
  const uncertainId=[...tasks.keys()].at(-1), paid=count();
  service.stop();service=createPersonReplacementService(deps);await service.tick();service.stop();
  assert.equal((await service.create(uncertainBody,'https://app.test')).id,uncertain.id);assert.equal(count(),paid);
  assert.throws(()=>service.retry(uncertain.id),/阿里云/);
  await assert.rejects(service.recoverTask(uncertain.id,completed.generationTaskId),/关联其他|原始提示词/);
  // A different prompt is not accepted just because the task is accessible with the API key.
  const entry=tasks.get(uncertainId), original=entry.body.input.prompt;entry.body.input.prompt='unrelated';
  await assert.rejects(service.recoverTask(uncertain.id,uncertainId),/原始提示词/);entry.body.input.prompt=original;
  failPost=false;await service.recoverTask(uncertain.id,uncertainId);assert.equal((await drive(uncertain.id)).stage,'completed');assert.equal(count(),paid);
  const rejected=await service.create(opts(),'https://app.test');rejectPost=true;
  const bad=await drive(rejected.id);assert.equal(bad.stage,'failed');assert.equal(bad.ambiguous,false);rejectPost=false;
  duration=16;const beforeLong=masks();await assert.rejects(service.create(opts(),'https://app.test'),/4-15秒/);assert.equal(masks(),beforeLong);
  assert.equal(normalizeWanEditTask({output:{task_status:'CANCELED'}}).status,'canceled');
  assert.equal(normalizeWanEditTask({output:{submit_time:'2026-10-21 10:00:00.000'}}).createdAt,Date.parse('2026-10-21T10:00:00+08:00')/1000);
  assert.equal(posts.every(p=>!p.url.includes('ark.cn-beijing.volces.com')),true);
  console.log('PASS: Wan direct-edit multipart media roles, 480/720/1080, native audio, masked input, provider keys/endpoints, restart, per-device ownership, retry, ambiguous-submit recovery, logical rejection, input duration, and no paid calls');
} finally { service.stop();db.close();await rm(root,{recursive:true,force:true}); }
