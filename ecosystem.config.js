module.exports = {
  apps: [{
    name: 'rss-bot',
    script: './dist/main.js',
    instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
    exec_mode: 'cluster',
    node_args: '--max-old-space-size=1024',
    env: {
      NODE_ENV: 'production',
    },
    env_development: {
      NODE_ENV: 'development',
    },
    max_memory_restart: '1200M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    kill_timeout: 10000,
    wait_ready: false,
    listen_timeout: 15000,
  }]
};
