'use strict';

// Replace these placeholders with the VPS production credentials.
// Generate SESSION_SECRET with: openssl rand -hex 32
const MONGODB_URI = 'REPLACE_WITH_YOUR_MONGODB_URI';
const SESSION_SECRET = 'REPLACE_WITH_YOUR_SESSION_SECRET';

function assertConfigured(name, value) {
  if (!value || value.startsWith('REPLACE_')) {
    throw new Error(`Set ${name} in ecosystem.config.cjs before starting PM2.`);
  }
}

assertConfigured('MONGODB_URI', MONGODB_URI);
assertConfigured('SESSION_SECRET', SESSION_SECRET);

module.exports = {
  apps: [
    {
      name: 'upvc-order-management',
      cwd: __dirname,
      script: 'artifacts/api-server/dist/index.mjs',
      node_args: '--enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3004',
        MONGODB_URI,
        SESSION_SECRET,
        LOG_LEVEL: 'info',
      },
    },
  ],
};