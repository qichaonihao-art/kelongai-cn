// One shared execution lane for local media work, including startup recovery.
// Process timeouts start after admission, so waiting does not consume them.
export function createMediaProcessExecutor(exec) {
  let tail = Promise.resolve();
  return function execute(file, args = [], options) {
    if (file !== 'ffmpeg') return exec(file, args, options);
    const run = () => {
      if (!args.includes('-i')) return exec(file, args, options);
      const bounded = ['-filter_threads', '1', '-filter_complex_threads', '1'];
      for (const arg of args) {
        if (arg === '-i') bounded.push('-threads', '1');
        bounded.push(arg);
      }
      // Keep all resolution, codec, quality, audio and frame-rate arguments.
      bounded.splice(bounded.length - 1, 0, '-threads', '1');
      return exec(file, bounded, options);
    };
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };
}
