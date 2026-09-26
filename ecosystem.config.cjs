'use strict';

// Replace the dummy values below before starting PM2.
// Generate a session secret with: openssl rand -hex 32
const MONGODB_URI =
  'mongodb+srv://raneaniket23_db_user:rSSscd98WASScFoO@windowsoftwarevishesh.lae0r4v.mongodb.net/?appName=windowsoftwarevishesh';
const SESSION_SECRET = 'hO92ZjFjQSkakUnW0waymD8CRqhkDrn0a156IqLs4cZLiPP0RDhXUUNtHGlkO9jKrN13NVIBTe5Uc1OX3bMY3w==';

function assertConfigured(name, value) {
  if (!value || value.includes('<') || value.startsWith('REPLACE_')) {
    throw new Error(
      `Replace the dummy ${name} value in ecosystem.config.cjs before starting PM2.`,
    );
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