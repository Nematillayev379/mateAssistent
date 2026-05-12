module.exports = {
  apps: [{
    name: "news-bot-pro",
    script: "npx",
    args: "tsx src/main.ts",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
    }
  }]
};
