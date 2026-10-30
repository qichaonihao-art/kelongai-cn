#!/usr/bin/env python3
"""Install the local media queue fix; run as root on the production server."""
from pathlib import Path
import datetime, shutil, subprocess, tarfile, os

root = Path('/www/wwwroot/kelongai-cn/legacy-project')
state = Path('/www/wwwroot/kelongai-runtime-state')
server = root / 'server.mjs'
env = root / '.env'
target = root / 'media-process-queue.mjs'
module = "// One shared execution lane for local media work, including startup recovery.\n// Process timeouts start after admission, so waiting does not consume them.\nexport function createMediaProcessExecutor(exec) {\n  let tail = Promise.resolve();\n  return function execute(file, args = [], options) {\n    if (file !== 'ffmpeg') return exec(file, args, options);\n    const run = () => {\n      if (!args.includes('-i')) return exec(file, args, options);\n      const bounded = ['-filter_threads', '1', '-filter_complex_threads', '1'];\n      for (const arg of args) {\n        if (arg === '-i') bounded.push('-threads', '1');\n        bounded.push(arg);\n      }\n      // Keep all resolution, codec, quality, audio and frame-rate arguments.\n      bounded.splice(bounded.length - 1, 0, '-threads', '1');\n      return exec(file, bounded, options);\n    };\n    const result = tail.then(run);\n    tail = result.catch(() => {});\n    return result;\n  };\n}\n"
old = 'const execFileAsync = promisify(execFile);'
new = 'const execFileAsync = createMediaProcessExecutor(promisify(execFile));'
imp = "import { createMediaProcessExecutor } from './media-process-queue.mjs';\n"
source = server.read_text()
if new in source and target.exists() and target.read_text() == module:
    print('This fix is already installed; no restart performed.')
    raise SystemExit(0)
assert os.geteuid() == 0, 'Run as root'
assert source.count(old) == 1 and 'createMediaProcessExecutor' not in source, 'Unexpected server version; nothing changed'
assert not target.exists(), 'Module already exists; nothing changed'
assert state.is_dir(), 'Runtime state directory missing'
assert any(line.strip() == 'RUNTIME_STATE_DIR=/www/wwwroot/kelongai-runtime-state' for line in env.read_text().splitlines()), 'Runtime state configuration differs; nothing changed'
backup = Path('/www/wwwroot/kelongai-runtime-state-backups') / ('media-queue-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True, exist_ok=False)
shutil.copy2(server, backup / 'server.mjs')
shutil.copy2(env, backup / '.env')
with tarfile.open(backup / 'runtime-state.tar.gz', 'w:gz') as archive:
    archive.add(state, arcname=state.name)
# tar is the required maintenance backup; also take a consistent SQLite snapshot.
import sqlite3
if (state / 'collection.db').exists():
    with sqlite3.connect(str(state / 'collection.db')) as src, sqlite3.connect(str(backup / 'collection.db')) as dst:
        src.backup(dst)
print('Backup:', backup, flush=True)
try:
    target.write_text(module)
    server.write_text(imp + source.replace(old, new))
    subprocess.run(['node', '--check', str(server)], check=True)
    # Limit simultaneous downloads; retain all cloud generation/quality settings.
    lines = [line for line in env.read_text().splitlines() if line.strip().split('=', 1)[0] != 'MEDIAKIT_ENHANCEMENT_DOWNLOAD_CONCURRENCY']
    env.write_text('\n'.join(lines + ['MEDIAKIT_ENHANCEMENT_DOWNLOAD_CONCURRENCY=2']) + '\n')
    subprocess.run(['pm2', 'restart', 'legacy-project'], check=True)
except BaseException:
    shutil.copy2(backup / 'server.mjs', server)
    shutil.copy2(backup / '.env', env)
    target.unlink(missing_ok=True)
    subprocess.run(['pm2', 'restart', 'legacy-project'], check=False)
    print('Installation failed; original code and settings restored. Runtime data was not overwritten.')
    raise
print('Installed. Local ffmpeg work now runs one at a time. Quality parameters are unchanged.')
subprocess.run(['free', '-h'], check=False)
subprocess.run(['pm2', 'list'], check=False)
