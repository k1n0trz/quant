const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const envProduction = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');

assert.ok(main.includes("'ANTHROPIC_API_KEY'"), 'main debe permitir ANTHROPIC_API_KEY en env.');
assert.ok(main.includes("'ANTHROPIC_MODEL'"), 'main debe permitir ANTHROPIC_MODEL en env.');
assert.ok(main.includes("'ANTHROPIC_BASE_URL'"), 'main debe permitir ANTHROPIC_BASE_URL en env.');
assert.ok(main.includes("provider.includes('anthropic')") || main.includes('provider.includes("anthropic")'), 'modelRoute debe reconocer DEFAULT_PROVIDER=anthropic.');
assert.ok(main.includes("provider.includes('claude')") || main.includes('provider.includes("claude")'), 'modelRoute debe reconocer DEFAULT_PROVIDER=claude.');
assert.ok(main.includes('https://api.anthropic.com/v1'), 'Anthropic debe usar base URL oficial por defecto.');
assert.ok(main.includes('/messages'), 'Anthropic debe llamar al endpoint Messages API.');
assert.ok(main.includes('x-api-key'), 'Anthropic debe usar header x-api-key.');
assert.ok(main.includes('anthropic-version'), 'Anthropic debe usar header anthropic-version.');
assert.ok(main.includes('claude-opus-4-8'), 'Claude Opus 4.8 debe quedar como modelo ejecutivo configurable por defecto.');
assert.ok(main.includes('data.content') && main.includes('.text'), 'chat debe parsear content[].text de Anthropic.');

assert.match(envExample, /^ANTHROPIC_API_KEY=/m, '.env.example debe documentar ANTHROPIC_API_KEY.');
assert.match(envExample, /^ANTHROPIC_MODEL=claude-opus-4-8/m, '.env.example debe documentar claude-opus-4-8.');
assert.match(envProduction, /^ANTHROPIC_API_KEY=/m, '.env.production.example debe documentar ANTHROPIC_API_KEY.');
assert.match(envProduction, /^ANTHROPIC_MODEL=claude-opus-4-8/m, '.env.production.example debe documentar claude-opus-4-8.');

console.log('anthropic_provider_static.test.js OK');
