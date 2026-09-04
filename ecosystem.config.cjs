const path = require('path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'xingye-snowluma',
      cwd: path.join(root, 'SnowLuma'),
      script: path.join(root, 'SnowLuma', 'index.mjs'),
      interpreter: 'node',
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'xingye-backend',
      cwd: path.join(root, 'bot-backend'),
      script: path.join(root, 'bot-backend', 'pm2-start.cjs'),
      interpreter: 'node',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        STEAM_PROXY_URL: process.env.STEAM_PROXY_URL || 'http://127.0.0.1:7890',
        STEAM_API_BASE: process.env.STEAM_API_BASE || 'https://api.steampowered.com',
        STEAM_STORE_BASE: process.env.STEAM_STORE_BASE || 'https://store.steampowered.com'
      }
    }
  ]
}
