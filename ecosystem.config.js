module.exports = {
  apps: [{
    name: "news-bot-pro",
    script: "dist/main.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "600M",
    env: {
      NODE_ENV: "production",
    }
  }]
};
