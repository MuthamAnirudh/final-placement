const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', '..');
const frontend = path.join(root, 'frontend', 'index.html');
const server = path.join(root, 'backend', 'server.js');
const gate = path.join(root, 'backend', 'src', 'routes', 'gatePasses.js');
const vault = path.join(root, 'backend', 'src', 'services', 'secretVault.js');
const vendor = path.join(root, 'frontend', 'vendor');
const report = {
  generatedAt: new Date().toISOString(),
  resumeSourceSha256: crypto.createHash('sha256').update(fs.readFileSync(frontend)).digest('hex'),
  checks: {
    serverHasCsp: fs.readFileSync(server, 'utf8').includes('Content-Security-Policy'),
    apiRateLimit: fs.readFileSync(server, 'utf8').includes('createApiRateLimiter'),
    csrfOriginGuard: fs.readFileSync(server, 'utf8').includes('createCsrfOriginGuard'),
    gateAtomicUpdate: fs.readFileSync(gate, 'utf8').includes('qrUsed: false') && fs.readFileSync(gate, 'utf8').includes('updateMany'),
    gatePublicNoBiometricBlob: !fs.readFileSync(gate, 'utf8').includes('studentPhoto: data.studentPhoto'),
    secretsExampleOnly: fs.existsSync(path.join(root, 'backend', '.env.example')),
    encryptedSystemSecrets: fs.readFileSync(vault, 'utf8').includes('aes-256-gcm') && fs.readFileSync(vault, 'utf8').includes('PORTAL_SECRETS_ENCRYPTION_KEY'),
    staticCspHashing: fs.readFileSync(frontend, 'utf8').includes("script-src 'self'") && !/script-src[^;]*'unsafe-inline'/.test(fs.readFileSync(frontend, 'utf8')),
    vendorBuildScript: fs.existsSync(path.join(root, 'backend', 'scripts', 'vendor-frontend-assets.js')),
  }
};
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.checks).some(v => !v)) process.exitCode = 1;
