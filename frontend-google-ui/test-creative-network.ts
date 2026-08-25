// 网络与幂等单元测试（前端纯逻辑，无真实 doubao/Seedance 调用）。
// 运行：npx tsx test-creative-network.ts
import {
  PAINTING_RETRIABLE_HTTP_STATUSES,
  PaintingHttpError,
  createPaintingBatchRun,
  getPaintingHttpStatus,
  isPaintingCreationOutcomeUnknown,
  isPaintingNetworkFailure,
  isPaintingRetriableHttpStatus,
  paintingRetryBackoffMs,
  describePaintingNetworkError,
  generatePaintingRequestId,
  getSeedanceRatePerSecond,
  waitForPaintingTask,
} from './src/lib/creative';

let passed = 0;
let failed = 0;

function assert(cond: unknown, label: string, extra?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 让 waitForPaintingTask 内部的 setTimeout 立即触发，避免真实等待 1.5s/退避。
function withFastTimers<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown };
  const orig = g.setTimeout;
  g.setTimeout = (cb: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) =>
    orig(cb as unknown, 0, ...args);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      g.setTimeout = orig;
    });
}

async function main() {
  // ===== 1. 错误分类与退避辅助函数 =====
  console.log('\n[1] 错误分类与退避辅助函数');
  {
    assert(isPaintingNetworkFailure(new Error('Failed to fetch')), 'Failed to fetch 判定为网络错误');
    assert(isPaintingNetworkFailure(new Error('NetworkError')), 'NetworkError 判定为网络错误');
    assert(isPaintingNetworkFailure(new Error('fetch failed')), 'fetch failed 判定为网络错误');
    assert(!isPaintingNetworkFailure(new Error('500 内部错误')), '普通业务错误不判定为网络错误');
    assert(isPaintingRetriableHttpStatus(502), '502 可重试');
    assert(isPaintingRetriableHttpStatus(503), '503 可重试');
    assert(isPaintingRetriableHttpStatus(504), '504 可重试');
    assert(isPaintingRetriableHttpStatus(408), '408 可重试');
    assert(isPaintingRetriableHttpStatus(429), '429 可重试');
    assert(!isPaintingRetriableHttpStatus(400), '400 不可重试');
    assert(!isPaintingRetriableHttpStatus(401), '401 不可重试');
    assert(!isPaintingRetriableHttpStatus(403), '403 不可重试');
    assert(PAINTING_RETRIABLE_HTTP_STATUSES.size === 5, '可重试状态码集合大小正确');
    assert(paintingRetryBackoffMs(1) === 1000, '退避 1→1000ms', String(paintingRetryBackoffMs(1)));
    assert(paintingRetryBackoffMs(2) === 2000, '退避 2→2000ms');
    assert(paintingRetryBackoffMs(3) === 4000, '退避 3→4000ms');
    assert(paintingRetryBackoffMs(4) === 8000, '退避 4→8000ms');
    assert(paintingRetryBackoffMs(9) === 8000, '退避封顶 8000ms');
  }

  // ===== 2. 幂等请求编号格式 =====
  console.log('\n[2] 幂等请求编号格式');
  {
    const id = generatePaintingRequestId('batch');
    assert(/^[A-Za-z0-9._-]{8,128}$/.test(id), '编号满足后端校验格式', id);
    assert(id.startsWith('batch-'), '编号带前缀', id);
    const id2 = generatePaintingRequestId('batch');
    assert(id !== id2, '每次生成编号不同', `${id} / ${id2}`);
  }

  // ===== 3. 错误文案中文化：绝不泄露 Failed to fetch =====
  console.log('\n[3] 错误文案中文化');
  {
    const network = describePaintingNetworkError(new Error('Failed to fetch'), '默认文案');
    assert(network.includes('网络连接暂时中断'), '网络错误转中文提示', network);
    assert(!/failed to fetch/i.test(network), '网络错误文案不含 Failed to fetch', network);

    const gateway = describePaintingNetworkError(new Error('504 gateway timeout'), '默认文案');
    assert(gateway.includes('代理超时'), '504 转代理超时提示', gateway);
    assert(!/failed to fetch/i.test(gateway), '504 文案不含 Failed to fetch', gateway);

    const auth = describePaintingNetworkError(new Error('unauthorized'), '默认文案');
    assert(auth.includes('登录状态已失效'), '401 转登录失效提示', auth);

    const other = describePaintingNetworkError(new Error('未知的业务错误'), '默认文案');
    assert(other === '未知的业务错误', '非网络错误保留原文案', other);
  }

  // ===== 3b. 付费批次创建结果不确定：网络错误及网关状态必须进入安全确认 =====
  console.log('\n[3b] 付费批次创建结果不确定分类');
  {
    assert(isPaintingCreationOutcomeUnknown(new Error('Failed to fetch')), '断网属于创建结果不确定');
    for (const status of [408, 429, 502, 503, 504]) {
      const error = new PaintingHttpError(`HTTP ${status}`, status);
      assert(getPaintingHttpStatus(error) === status, `保留 HTTP ${status} 状态码`);
      assert(isPaintingCreationOutcomeUnknown(error), `HTTP ${status} 属于创建结果不确定`);
    }
    for (const status of [400, 401, 403]) {
      assert(!isPaintingCreationOutcomeUnknown(new PaintingHttpError(`HTTP ${status}`, status)), `HTTP ${status} 属于明确失败`);
    }
    const gateway = describePaintingNetworkError(new PaintingHttpError('上游超时', 504), '默认文案');
    assert(gateway.includes('代理超时'), '结构化 504 转为中文代理超时提示', gateway);
  }

  // ===== 3c. 正式创建接口必须把 HTTP 状态带回页面判断层 =====
  console.log('\n[3c] 正式创建接口保留 HTTP 状态');
  {
    const origFetch = globalThis.fetch;
    const options = {
      file: new File([new Uint8Array([1])], 'painting.png', { type: 'image/png' }),
      profile: {},
      plan: {},
      ideas: [],
      totalDirections: 40,
      model: 'doubao-seedance-2-0-mini-260615',
      resolution: '720p',
      ratio: '9:16',
      variationRound: 0,
      generateAudio: false,
      watermark: false,
      stylePreset: 'modern-minimal',
      creationRequestId: 'batch-network-test-0001',
    } as Parameters<typeof createPaintingBatchRun>[0];
    try {
      globalThis.fetch = (async () => jsonResponse({ error: '网关超时' }, 504)) as typeof fetch;
      await createPaintingBatchRun(options);
      assert(false, 'HTTP 504 应抛错');
    } catch (error) {
      assert(getPaintingHttpStatus(error) === 504, '创建接口抛出的错误保留 504 状态');
      assert(isPaintingCreationOutcomeUnknown(error), '创建接口 504 会进入安全确认流程');
    }
    try {
      globalThis.fetch = (async () => jsonResponse({ error: '参数错误' }, 400)) as typeof fetch;
      await createPaintingBatchRun(options);
      assert(false, 'HTTP 400 应抛错');
    } catch (error) {
      assert(getPaintingHttpStatus(error) === 400, '创建接口抛出的错误保留 400 状态');
      assert(!isPaintingCreationOutcomeUnknown(error), '创建接口 400 不会盲目重试');
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ===== 4. 轮询：前两次断网，第三次成功，最终拿到结果 =====
  console.log('\n[4] 轮询：前两次断网后成功（连续失败计数重置）');
  {
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls <= 2) throw new Error('Failed to fetch');
      return jsonResponse({ status: 'done', result: { profile: { name: '测试挂画' } } });
    }) as typeof fetch;
    try {
      const result = await withFastTimers(() => waitForPaintingTask<{ profile: { name: string } }>('t-1', '挂画分析失败'));
      assert(result?.profile?.name === '测试挂画', '断网重试后成功拿到结果', JSON.stringify(result));
      assert(calls === 3, '恰好轮询 3 次', String(calls));
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ===== 5. 轮询：502/503/504 可重试，最终成功 =====
  console.log('\n[5] 轮询：502/503/504 可重试');
  {
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: 'bad gateway' }, 502);
      if (calls === 2) return jsonResponse({ error: 'unavailable' }, 503);
      return jsonResponse({ status: 'done', result: { ok: true } });
    }) as typeof fetch;
    try {
      const result = await withFastTimers(() => waitForPaintingTask<{ ok: boolean }>('t-2', '提交失败'));
      assert(result?.ok === true, 'HTTP 可重试错误后成功', JSON.stringify(result));
      assert(calls === 3, '恰好重试到成功', String(calls));
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ===== 6. 轮询：401 不盲目重试，立即抛错 =====
  console.log('\n[6] 轮询：401 不重试，立即抛错');
  {
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ error: '登录状态已失效，请重新登录' }, 401);
    }) as typeof fetch;
    try {
      await withFastTimers(() => waitForPaintingTask<unknown>('t-3', '提交失败'));
      assert(false, '401 应抛错');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert(msg.includes('登录状态已失效'), '401 错误信息保留', msg);
      assert(!/failed to fetch/i.test(msg), '401 错误不含 Failed to fetch', msg);
      assert(calls === 1, '401 只请求一次不重试', String(calls));
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ===== 7. 轮询：连续断网超过 5 次，抛中文错误（不含 Failed to fetch） =====
  console.log('\n[7] 轮询：连续断网超限抛中文错误');
  {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;
    try {
      await withFastTimers(() => waitForPaintingTask<unknown>('t-4', '挂画分析失败'));
      assert(false, '超限应抛错');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert(msg.includes('网络连接暂时中断'), '超限抛中文网络错误', msg);
      assert(!/failed to fetch/i.test(msg), '超限错误不含 Failed to fetch', msg);
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ===== 8. H3试验模型价格只接受768P =====
  console.log('\n[8] MiniMax H3 试验价格口径');
  {
    assert(getSeedanceRatePerSecond('MiniMax-H3', '768p') === 0.5, 'H3 768P = 0.50元/秒');
    assert(getSeedanceRatePerSecond('MiniMax-H3', '720p') === null, 'H3不误用Seedance 720P价格');
    assert(getSeedanceRatePerSecond('MiniMax-H3', '2K') === null, 'H3试验版尚未开放2K价格入口');
  }

  console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试运行异常：', e);
  process.exit(1);
});
