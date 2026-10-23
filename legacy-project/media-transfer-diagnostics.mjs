// Never log request URLs: media paths contain bearer tokens.
export function observeMediaTransfer(res, details, log = console.info) {
  const startedAt = Date.now();
  let bytesRead = 0;
  let reported = false;
  const emit = event => {
    try { log('[person-replacement media]', { ...details, ...event }); } catch {}
  };
  emit({ event: 'start' });
  const report = () => {
    if (reported) return;
    reported = true;
    emit({ event: 'end', status: res.statusCode, completed: res.writableFinished,
      bytesRead, elapsedMs: Date.now() - startedAt });
  };
  res.once('finish', report);
  res.once('close', report);
  return chunk => { bytesRead += chunk.length; };
}
