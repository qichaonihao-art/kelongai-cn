# Personal Plank Tracker

Standalone personal service for `plank.mujiabian.cn`. It does not share code, authentication, cookies, data, logs, or process state with the AI work platform.

## Local verification

```bash
npm test
npm run dev
```

Open `http://127.0.0.1:3100`. The local development password is `dev-password`.

## Production layout

- App: `/www/wwwroot/plank-tracker`
- Data: `/www/wwwroot/plank-tracker-data/plank.db`
- Backups: `/www/wwwroot/plank-tracker-backups`
- Process: `personal-plank-tracker`, bound to `127.0.0.1:3100`
- Public entry: Nginx virtual host `plank.mujiabian.cn`

Create `.env` from `.env.example` with a unique password and a random session secret. Do not reuse the AI work platform password.

The browser keeps a small offline queue and syncs completed sessions when the network returns. JSON import accepts both this app's export format and the legacy `plank_sessions` array.
