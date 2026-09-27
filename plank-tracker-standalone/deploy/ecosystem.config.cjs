module.exports = {
  apps: [{
    name: 'personal-plank-tracker',
    cwd: '/www/wwwroot/plank-tracker',
    script: 'server.mjs',
    node_args: '--env-file=.env',
    autorestart: true,
    max_memory_restart: '180M',
    env: { NODE_ENV: 'production' }
  }]
};
