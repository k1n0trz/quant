const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

for (const id of [
  'systemSelfAuditPanel',
  'systemSelfAuditRefreshBtn',
  'systemSelfAuditRunBtn',
  'systemSelfAuditStatus',
  'systemSelfAuditFindings',
  'systemSelfAuditHistory'
]) {
  assert.ok(html.includes(`id="${id}"`), `Falta ${id} en Configuracion.`);
}

assert.ok(renderer.includes('systemSelfAuditStatus:'), 'Renderer debe exponer wrapper de status self-audit.');
assert.ok(renderer.includes('systemSelfAuditRun:'), 'Renderer debe exponer wrapper de run self-audit.');
assert.ok(renderer.includes('systemSelfAuditHistory:'), 'Renderer debe exponer wrapper de history self-audit.');
assert.ok(renderer.includes('loadSystemSelfAudit'), 'Renderer debe cargar el panel de self-audit.');
assert.ok(renderer.includes("window.quant.systemSelfAuditRun()"), 'El run manual debe invocar auditoria backend.');
assert.ok(renderer.includes("name === 'settings'"), 'Settings debe activar cargas auxiliares.');
assert.ok(renderer.includes('loadSystemSelfAudit();'), 'Entrar a Configuracion debe cargar self-audit.');
assert.ok(renderer.includes('System self-audit:'), 'El contexto del chat debe incluir self-audit backend.');

assert.ok(css.includes('.self-audit-panel'), 'CSS debe definir panel self-audit.');
assert.ok(css.includes('.self-audit-finding'), 'CSS debe definir hallazgos self-audit.');
assert.ok(css.includes('@media (max-width: 720px)'), 'CSS debe cubrir mobile.');

assert.ok(main.includes('systemSelfAuditScheduler.start'), 'main debe autoiniciar scheduler self-audit.');
assert.ok(main.includes('SYSTEM_SELF_AUDIT_REMEDIATION_ENABLED'), 'main debe leer flag de remediacion.');
assert.equal(/placeOrderBinance|signedBinance/.test(html.match(/id="systemSelfAuditPanel"[\s\S]*?id="settingsAlertsMount"/)?.[0] || ''), false, 'Panel self-audit no debe tocar ejecucion real.');

console.log('system_self_audit_ui_static.test.js OK');
