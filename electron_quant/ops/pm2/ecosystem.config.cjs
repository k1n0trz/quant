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
        REAL_TRADING: 'false',
        TRAINING_BACKEND_LOOP_ENABLED: 'true',
        TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
        TRAINING_BACKEND_LOOP_INTERVAL_MS: '60000',
        TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
        TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true'
      }
    }
  ]
};
