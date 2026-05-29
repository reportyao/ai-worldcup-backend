module.exports = {
  apps: [
    {
      name: 'ai-worldcup-api',
      cwd: '/home/ubuntu/apps/ai-worldcup-backend',
      script: 'apps/api/dist/src/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      out_file: '/home/ubuntu/logs/ai-worldcup-api.out.log',
      error_file: '/home/ubuntu/logs/ai-worldcup-api.err.log',
      time: true,
    },
    {
      name: 'ai-worldcup-worker',
      cwd: '/home/ubuntu/apps/ai-worldcup-backend',
      script: 'apps/worker/dist/src/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      out_file: '/home/ubuntu/logs/ai-worldcup-worker.out.log',
      error_file: '/home/ubuntu/logs/ai-worldcup-worker.err.log',
      time: true,
    },
  ],
};
