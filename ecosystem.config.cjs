'use strict';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Load deploy/production.env before starting PM2.`,
    );
  }
  return value;
}

module.exports = {
  apps: [
    {
      name: 'upvc-order-management-api',
      cwd: __dirname,
      script: 'artifacts/api-server/dist/index.mjs',
      node_args: '--enable-source-maps',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 1000,
      env_production: {
        NODE_ENV: 'production',
        PORT: '8080',
        MONGODB_URI: requiredEnv('MONGODB_URI'),
        SESSION_SECRET: requiredEnv('SESSION_SECRET'),
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      },
    },
  ],
};