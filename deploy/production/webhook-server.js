#!/usr/bin/env node
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || '/home/ubuntu/deploy/ai-worldcup-deploy.sh';
const DEPLOY_LOG = process.env.DEPLOY_LOG || '/home/ubuntu/logs/ai-worldcup-deploy.log';
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const ALLOWED_REPOS = new Set((process.env.ALLOWED_REPOS || 'reportyao/ai-worldcup-backend,reportyao/ai-worldcup-frontend').split(',').map((s) => s.trim()).filter(Boolean));
const LOCK_FILE = process.env.DEPLOY_LOCK_FILE || '/tmp/ai-worldcup-deploy.lock';

function verifySignature(signature, body) {
  if (!SECRET) return false;
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function runDeploy(reason) {
  if (fs.existsSync(LOCK_FILE)) {
    return { accepted: false, message: 'deployment already running' };
  }
  fs.writeFileSync(LOCK_FILE, String(Date.now()));
  const out = fs.openSync(DEPLOY_LOG, 'a');
  fs.writeSync(out, `\n[${new Date().toISOString()}] webhook accepted: ${reason}\n`);
  const child = spawn('/bin/bash', [DEPLOY_SCRIPT], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, DEPLOY_BRANCH: BRANCH },
  });
  child.on('exit', (code) => {
    try { fs.writeSync(out, `[${new Date().toISOString()}] deploy exited with code ${code}\n`); } catch (_) {}
    try { fs.closeSync(out); } catch (_) {}
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  });
  child.unref();
  return { accepted: true, pid: child.pid };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/github-webhook') {
    return json(res, 404, { error: 'not found' });
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!verifySignature(req.headers['x-hub-signature-256'], body)) {
      return json(res, 401, { error: 'invalid signature' });
    }
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      return json(res, 202, { skipped: true, reason: `ignored event ${event}` });
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch (err) { return json(res, 400, { error: 'invalid json' }); }
    const repo = payload.repository && payload.repository.full_name;
    const ref = payload.ref;
    if (!ALLOWED_REPOS.has(repo)) {
      return json(res, 202, { skipped: true, reason: `ignored repo ${repo}` });
    }
    if (ref !== `refs/heads/${BRANCH}`) {
      return json(res, 202, { skipped: true, reason: `ignored ref ${ref}` });
    }
    const result = runDeploy(`${repo}@${BRANCH} ${payload.after || ''}`);
    return json(res, result.accepted ? 202 : 409, result);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI World Cup webhook server listening on 127.0.0.1:${PORT}`);
});
