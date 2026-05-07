module.exports = {
  apps: [
    {
      name: 'quant-backend',
      script: 'main.js',
      cwd: __dirname + '/../..',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      time: true,
      env: {
        NODE_ENV: 'production',
        QUANT_WEB_HOST: '127.0.0.1',
        QUANT_WEB_PORT: 47829,
        REAL_TRADING: 'false'
      }
    }
  ]
};
