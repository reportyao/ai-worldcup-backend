module.exports = {
  apps: [
    {
      name: 'ai-worldcup-webhook',
      script: '/home/ubuntu/deploy/webhook-server.js',
      cwd: '/home/ubuntu/deploy',
      env: {
        NODE_ENV: 'production',
        WEBHOOK_PORT: '9000',
        DEPLOY_SCRIPT: '/home/ubuntu/deploy/ai-worldcup-deploy.sh',
        DEPLOY_LOG: '/home/ubuntu/logs/ai-worldcup-deploy.log',
        DEPLOY_BRANCH: 'main',
        ALLOWED_REPOS: 'reportyao/ai-worldcup-backend,reportyao/ai-worldcup-frontend,reportyao/ai-worldcup-admin',
      },
      out_file: '/home/ubuntu/logs/ai-worldcup-webhook.out.log',
      error_file: '/home/ubuntu/logs/ai-worldcup-webhook.err.log',
      time: true,
    },
  ],
};
