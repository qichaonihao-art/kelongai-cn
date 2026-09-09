import assert from 'node:assert/strict';

process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = `/tmp/kelong-volc-asr-test-${process.pid}`;
process.env.VOLC_ASR_API_KEY = 'test-only';

const { buildVolcAsrContext, normalizeVolcAsrSentences, transcribeAudioWithVolcWordTimestamps } = await import('./server.mjs');

const context = JSON.parse(buildVolcAsrContext('静心 PVC 背胶贴画 无纺布 实木木条'));
assert.equal(context.context_type, 'dialog_ctx');
assert.match(context.context_data[0].text, /PVC/);
assert.ok(JSON.parse(buildVolcAsrContext('文'.repeat(800))).context_data[0].text.length <= 400);
assert.equal(buildVolcAsrContext(''), undefined);

const sentences = normalizeVolcAsrSentences({
  result: {
    utterances: [{
      text: '静心挂画',
      start_time: 100,
      end_time: 900,
      words: [
        { text: '静', start_time: 100, end_time: 300 },
        { text: '心', start_time: 300, end_time: 500 },
        { text: '挂画', start_time: 500, end_time: 900 }
      ]
    }]
  }
});
assert.deepEqual(sentences[0].words[2], { text: '挂画', begin_time: 500, end_time: 900 });
assert.throws(() => normalizeVolcAsrSentences({ result: { utterances: [] } }), /结果为空/);
assert.throws(() => normalizeVolcAsrSentences({
  result: { utterances: [{ text: '静', words: [{ text: '静', start_time: 100, end_time: 100 }] }] }
}), /时间戳无效/);

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const headers = { 'X-Api-Status-Code': '20000000', 'X-Api-Message': 'OK' };
  if (String(url).endsWith('/submit')) return new Response('', { status: 200, headers });
  return Response.json({
    result: {
      text: '静心挂画',
      utterances: [{
        text: '静心挂画', start_time: 100, end_time: 900,
        words: [
          { text: '静', start_time: 100, end_time: 300 },
          { text: '心', start_time: 300, end_time: 500 },
          { text: '挂画', start_time: 500, end_time: 900 }
        ]
      }]
    }
  }, { headers });
};
const recognized = await transcribeAudioWithVolcWordTimestamps({
  audioUrl: 'https://example.test/private-random-audio.wav',
  text: '静心挂画',
  parentDeadlineAt: Date.now() + 10_000
});
assert.equal(recognized[0].words[0].begin_time, 100);
assert.equal(calls.length, 2);
assert.equal(calls[0].init.headers['X-Api-Key'], 'test-only');
assert.equal(calls[0].init.headers['X-Api-Resource-Id'], 'volc.seedasr.auc');
assert.equal(calls[0].init.headers['X-Api-Sequence'], '-1');
const submitBody = JSON.parse(calls[0].init.body);
assert.equal(submitBody.request.show_utterances, true);
assert.equal(submitBody.request.enable_itn, false);
assert.equal(submitBody.request.enable_punc, false);
assert.match(submitBody.request.corpus.context, /静心挂画/);

console.log('volc asr tests passed');
