import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyCopyEdits, createCopyTransferService, normalizeCopySentences } from './copy-transfer.mjs';

test('local patches preserve every unrelated character and reject ambiguous edits', () => {
  const sentences = [{ text: '曾国藩挂在床头墙上，寓意很好。', speakerId: '0', start: 0, end: 3 }];
  const revised = applyCopyEdits(sentences, [{ index: 0, patches: [{ from: '挂在床头墙上', to: '摆在床头柜上' }] }]);
  assert.equal(revised[0].revised, '曾国藩摆在床头柜上，寓意很好。');
  assert.throws(() => applyCopyEdits(sentences, [{ index: 0, patches: [{ from: '不存在', to: '别的' }] }]), /无法准确定位/);
  assert.throws(() => applyCopyEdits(sentences, [{ index: 0, patches: [] }, { index: 0, patches: [] }]), /重复/);
});

test('ASR timestamps reject overlaps rather than losing speaker placement', () => {
  assert.deepEqual(normalizeCopySentences([{ text: '你好', speaker_id: 2, begin_time: 1000, end_time: 2000 }], 3)[0], {
    text: '你好', speakerId: '2', start: 1, end: 2,
  });
  assert.throws(() => normalizeCopySentences([
    { text: '一', begin_time: 0, end_time: 1500 },
    { text: '二', begin_time: 1000, end_time: 2000 },
  ], 3), /同时说话/);
});

test('render retains original vocal outside changed window and music at its source timing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'copy-transfer-'));
  const sourceId = 'a'.repeat(24);
  const vocalId = 'b'.repeat(24);
  const synthId = 'c'.repeat(24);
  try {
    await Promise.all([
      writeFile(path.join(dir, `${vocalId}_vt_vocal.wav`), 'vocal'),
      writeFile(path.join(dir, `${vocalId}_vt_music.wav`), 'music'),
      writeFile(path.join(dir, `${synthId}_vt_output.mp3`), 'tts'),
    ]);
    let ffmpegArgs;
    const service = createCopyTransferService({
      uploadTempDir: dir,
      voiceService: {
        async separateForCopy() {
          return {
            vocalId, musicId: vocalId, endSeconds: 10,
            sentences: [
              { text: '原文不改。', speaker_id: 1, begin_time: 1000, end_time: 2500 },
              { text: '挂在墙上。', speaker_id: 1, begin_time: 4000, end_time: 6000 },
            ],
            speakers: [{ speakerId: 1, vocalId, durationSeconds: 8 }],
          };
        },
        async synthesizeMp3({ text }) {
          assert.equal(text, '摆在桌上。');
          return { audioUrl: `/uploads/${synthId}_vt_output.mp3` };
        },
      },
      editText: async () => [{ index: 1, patches: [{ from: '挂在墙上', to: '摆在桌上' }] }],
      probeDuration: async () => 2,
      exec: async (_cmd, args) => {
        if (_cmd === 'tar') { assert.match(args[1], /_copy_package\.tar\.gz$/); return; }
        ffmpegArgs = args;
        await writeFile(args[args.length - 1], 'result');
      },
      scheduleCleanup: () => {},
    });
    const plan = await service.analyze({ sourceId, target: { name: '摆台', usage: '摆放' } });
    assert.equal(plan.sentences[0].revised, '原文不改。');
    assert.equal(plan.sentences[1].revised, '摆在桌上。');
    const output = await service.render({ planId: plan.planId, revisions: plan.sentences.map((s) => s.revised) }, {});
    assert.equal(output.duration, 10);
    const filter = ffmpegArgs[ffmpegArgs.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[1:a\]aresample=24000,volume=0.9\[bed\]/);
    assert.match(filter, /atrim=start=0.000:end=4.000/);
    assert.match(filter, /adelay=4000:all=1\[new0\]/);
    assert.match(filter, /atrim=start=6.000:end=10.000/);
    const archive = await service.bundle({ outputIds: [output.outputId] });
    assert.match(archive.archiveUrl, /_copy_package\.tar\.gz$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
