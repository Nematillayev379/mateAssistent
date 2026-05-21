module.exports = {
  apps: [{
    name: 'rss-bot',
    script: './dist/main.js',
    instances: process.env.NODE_ENV === 'production' ? 0 : 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    env_development: {
      NODE_ENV: 'development',
    },
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 10000,
    wait_ready: false,
    listen_timeout: 15000,
  }]
};
