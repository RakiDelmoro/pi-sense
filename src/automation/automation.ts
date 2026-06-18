import { startAutomationRunner } from './runner';

// Sanitize env vars — Windows CRLF .env files and Docker env_file can inject trailing whitespace
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed !== v) process.env[k] = trimmed;
  }
}

await startAutomationRunner();

console.log('🤖 Pi Sense automation service running');
