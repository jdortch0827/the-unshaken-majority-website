import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const stubDir = path.join(root, 'node_modules', '@supabase', 'supabase-js');
const hadSupabasePackage = fs.existsSync(stubDir);

// The pure investigation helpers do not call Supabase. This lightweight test-only
// module lets the helpers be imported in an offline validation environment where
// npm registry access is unavailable. It is never included in the final package.
if (!hadSupabasePackage) {
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'package.json'), JSON.stringify({ name: '@supabase/supabase-js', version: '0.0.0-test-stub', type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(stubDir, 'index.js'), 'export function createClient(){ throw new Error("Supabase test stub must not be called"); }\n');
}

const { sanitizeRichText, slugify, validateAdminFile, makeEvidencePaths } = await import('../server/investigations.js');

if (!hadSupabasePackage) {
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
}

test('slugify creates clean human-readable slugs', () => {
  assert.equal(slugify("Coca-Cola's Custom Can Filter"), 'coca-cola-s-custom-can-filter');
});

test('rich text sanitizer preserves allowed formatting and removes scripts', () => {
  const clean = sanitizeRichText('<h2>Finding</h2><script>alert(1)</script><p><strong>Safe</strong> <a href="javascript:alert(1)">bad</a></p>');
  assert.match(clean, /<h2>Finding<\/h2>/);
  assert.doesNotMatch(clean, /<script|javascript:/i);
  assert.match(clean, /<strong>Safe<\/strong>/);
});

test('rich text sanitizer removes inline event attributes and unsafe elements', () => {
  const clean = sanitizeRichText('<p onclick="steal()">Text</p><iframe src="https://example.com"></iframe>');
  assert.equal(clean, '<p>Text</p>');
});

test('evidence validation accepts supported files and rejects oversized files', () => {
  const valid = validateAdminFile({ name:'Exhibit A.png', type:'image/png', size:1024 });
  assert.equal(valid.extension,'png');
  assert.throws(() => validateAdminFile({ name:'bad.exe', type:'application/octet-stream', size:1024 }));
  assert.throws(() => validateAdminFile({ name:'large.pdf', type:'application/pdf', size:51*1024*1024 }));
});

test('evidence paths are isolated by case and evidence id', () => {
  const paths = makeEvidencePaths('UM-2026-001','abc',{originalName:'evidence.png',contentType:'image/png'});
  assert.match(paths.originalPath,/^investigations\/UM-2026-001\/abc\/original-/);
  assert.match(paths.previewPath,/^investigations\/UM-2026-001\/abc\/preview-/);
});
