import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = await mkdtemp(path.join(tmpdir(), 'kelong-aliyun-subtitle-hotwords-'));
try {
  const audioPath = path.join(root, 'narration.wav');
  await writeFile(audioPath, 'mock audio');
  const words = [{ text: '柿柿如意', begin_time: 150, end_time: 900 }];
  const sentences = [{ text: '柿柿如意', words }];
  const created = [];
  const submitted = [];
  let rejectVocabularyId = '';
  const fetch = async (url, init) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/uploads')) {
      return Response.json({ data: {
        upload_host: 'https://upload.aliyuncs.com', upload_dir: 'mock',
        policy: 'policy', signature: 'signature', oss_access_key_id: 'test-only'
      } });
    }
    if (target.hostname === 'upload.aliyuncs.com') return new Response();
    if (target.pathname.endsWith('/customization')) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'speech-biasing');
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      created.push(body.input);
      if (body.input.vocabulary.some(({ text }) => text === '失败词库')) return new Response(null, { status: 503 });
      return Response.json({ output: { vocabulary_id: `vocab-qingjian-${created.length}` } });
    }
    if (target.pathname.endsWith('/transcription')) {
      const body = JSON.parse(init.body);
      submitted.push(body);
      if (rejectVocabularyId && body.parameters.vocabulary_id === rejectVocabularyId) {
        return Response.json({ message: 'Invalid vocabulary_id' }, { status: 400 });
      }
      return Response.json({ output: { task_id: 'mock-task' } });
    }
    if (target.pathname.endsWith('/tasks/mock-task')) {
      return Response.json({ output: {
        task_status: 'SUCCEEDED', results: [{ transcription_url: 'https://result.aliyuncs.com/subtitles' }]
      } });
    }
    if (target.hostname === 'result.aliyuncs.com') return Response.json({ transcripts: [{ sentences }] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const server = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  const start = server.indexOf('const DASHSCOPE_FILES_BASE_URL =');
  const end = server.indexOf('async function handleLocalEditorSubtitleAlign', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    path, URL, AbortSignal, Blob, FormData, fetch, setTimeout, createHash, randomUUID,
    mkdir, readFile, rename, unlink, writeFile, console,
    RUNTIME_STATE_DIR: root,
    SERVER_CONFIG: { dashscopeApiKey: 'test-only' },
    readValue: (value) => String(value || '').trim(),
    sleep: async () => {}
  });
  vm.runInContext(server.slice(start, end), context);
  const recognize = (contextText) => context.transcribeAudioWithAliyunWordTimestamps({ audioPath, contextText });
  const batch = await Promise.all([
    recognize('柿柿如意\nＰＶＣ 背胶\n柿柿如意\n超出阿里云词条长度上限的这一整句话不会提交'),
    recognize('PVC 背胶\n柿柿如意'),
    recognize(''),
    recognize('失败词库'),
    recognize('福人居')
  ]);
  for (const result of batch) assert.deepEqual(result, sentences);
  assert.equal(created.length, 3);
  const shared = created.find((entry) => entry.vocabulary.length === 2);
  assert.deepEqual(shared, {
    action: 'create_vocabulary', target_model: 'paraformer-v2', prefix: 'qingjian',
    vocabulary: [{ text: 'PVC 背胶', weight: 4 }, { text: '柿柿如意', weight: 4 }]
  });
  const sharedId = `vocab-qingjian-${created.indexOf(shared) + 1}`;
  assert.equal(submitted.filter(({ parameters }) => parameters.vocabulary_id === sharedId).length, 2);
  assert.equal(submitted.filter(({ parameters }) => !parameters.vocabulary_id).length, 2);
  assert.ok(submitted.every(({ model, parameters }) => model === 'paraformer-v2' && parameters.timestamp_alignment_enabled));

  rejectVocabularyId = sharedId;
  assert.deepEqual(await recognize('柿柿如意\nPVC 背胶'), sentences);
  assert.equal(created.length, 3);
  assert.equal(submitted.at(-2).parameters.vocabulary_id, sharedId);
  assert.equal(submitted.at(-1).parameters.vocabulary_id, undefined);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('aliyun subtitle hotword tests passed');
