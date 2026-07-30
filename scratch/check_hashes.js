const fs = require('fs');
const crypto = require('crypto');
const content = fs.readFileSync('public/admin.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRegex.exec(content)) !== null) {
  const scriptTag = match[0];
  const scriptContent = match[1];
  if (/\bsrc\s*=/i.test(scriptTag)) continue;
  const normalized = scriptContent.replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(normalized).digest('base64');
  const cspString = `'sha256-${hash}'`;
  const hashes = JSON.parse(fs.readFileSync('csp-hashes.json', 'utf8')).scriptHashes;
  console.log('Admin Script Hash:', cspString);
  console.log('Is in csp-hashes.json:', hashes.includes(cspString));
}
