import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const errors = [];
const expected = [
  'index.html','investigations.html','investigation.html','standards.html','submit.html','contact.html','correction.html','privacy.html','404.html',
  'admin-login.html','admin-investigations.html','admin-investigation-editor.html','admin-preview.html','admin.js','admin.css',
  'api/investigation-data.js','api/investigation-page.js','api/admin.js','api/prepare-correction.js','api/finalize-correction.js',
  'server/api-handlers/investigations.js','server/api-handlers/investigation.js','server/api-handlers/latest-investigation.js','server/api-handlers/sitemap.js',
  'server/api-handlers/admin-session.js','server/api-handlers/admin-investigations.js','server/api-handlers/admin-investigation.js','server/api-handlers/admin-evidence.js','server/api-handlers/admin-corrections.js',
  'setup/002_investigations.sql','assets/shield.png','assets/seal.png','assets/banner-dark.png','assets/social-preview.jpg','vercel.json'
];
for (const file of expected) if (!fs.existsSync(path.join(root,file))) errors.push(`Missing required file: ${file}`);

const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
const localAssetPattern = /(?:src|href)=["'](\/(?!\/)[^"'#?]+)["']/g;
const routeAllow = [/^\/$/,/^\/admin(?:\/|$)/,/^\/investigations(?:\/|$)/,/^\/(?:standards|submit|contact|correction|privacy|404)$/,/^\/api\//];
for (const name of htmlFiles) {
  const content = fs.readFileSync(path.join(root,name),'utf8');
  for (const match of content.matchAll(localAssetPattern)) {
    const target = match[1];
    if (routeAllow.some(re => re.test(target))) continue;
    const file = target.replace(/^\//,'');
    if (!fs.existsSync(path.join(root,file))) errors.push(`${name}: broken local reference ${target}`);
  }
  if (/admin-/.test(name) && !/noindex/.test(content)) errors.push(`${name}: protected page is missing noindex`);
  const ids = [...content.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) errors.push(`${name}: duplicate element id(s): ${[...new Set(duplicates)].join(', ')}`);
}

const allText = [];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git'].includes(entry.name))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(?:js|json|html|css|sql|md|txt|example)$/.test(entry.name))allText.push([path.relative(root,full),fs.readFileSync(full,'utf8')]);}}
walk(root);
for(const [file,content] of allText){
  if (/\bsb_secret_[A-Za-z0-9_-]{12,}/.test(content) || /\bre_[A-Za-z0-9_-]{20,}/.test(content)) errors.push(`${file}: appears to contain a live secret`);
  if (/service_role\s*[=:]\s*["'][A-Za-z0-9._-]{20,}/i.test(content)) errors.push(`${file}: appears to contain an embedded service-role key`);
}

for(const image of ['shield.png','seal.png','banner-dark.png','social-preview.jpg']){
  if(fs.existsSync(path.join(root,image))) errors.push(`Duplicate brand asset in repository root: ${image}`);
}

const vercel = JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const rewriteSources = new Set((vercel.rewrites||[]).map(item=>item.source));
for(const route of ['/api/investigations','/api/investigation','/api/latest-investigation','/api/sitemap','/api/admin-session','/api/admin-investigations','/api/admin-investigation','/api/admin-evidence','/api/admin-corrections','/investigations/:slug','/admin/login','/admin/investigations','/admin/investigations/new','/admin/investigations/:id/edit','/admin/investigations/:id/preview','/sitemap.xml']){
  if(!rewriteSources.has(route)) errors.push(`Missing Vercel rewrite: ${route}`);
}
const detailRewrite = (vercel.rewrites || []).find((item) => item.source === '/investigations/:slug');
if (detailRewrite?.destination !== '/api/investigation-page?slug=:slug') errors.push('Investigation detail route is not using the server-rendered metadata page.');

const investigationTemplate = fs.readFileSync(path.join(root, 'investigation.html'), 'utf8');
for (const token of ['twitter-title', 'twitter-description', 'twitter-image', 'canonical-url', 'og-title', 'og-description', 'og-image']) {
  if (!investigationTemplate.includes(token)) errors.push(`Investigation template missing metadata marker: ${token}`);
}

const migration = fs.readFileSync(path.join(root,'setup/002_investigations.sql'),'utf8');
for(const token of ['UM-2026-001','coca-cola-custom-can-filter','investigation_audit_logs','correction_requests','investigation-evidence']){
  if(!migration.includes(token)) errors.push(`Migration missing expected token: ${token}`);
}


// Repository-structure safeguards: Vercel functions must stay in /api,
// shared backend code must stay in /server, and browser scripts must not be
// overwritten by serverless handlers.
const forbiddenRootFiles = [
  '002_investigations.sql','003_bootstrap_admin.sql.example','env.example',
  'admin-corrections.js','admin-evidence.js','admin-investigation.js','admin-investigations.js','admin-session.js',
  'finalize-case.js','finalize-correction.js','form-config.js','health.js','investigation-page.js','investigation.js',
  'prepare-case.js','prepare-correction.js','sitemap.js','submit-contact.js','shared.js',
  'banner-dark-mobile.png','banner-dark-tablet.png','banner-dark.png','favicon.png','seal.png','shield.png','social-preview.jpg'
];
for (const file of forbiddenRootFiles) {
  if (fs.existsSync(path.join(root, file))) errors.push(`Misplaced duplicate file in repository root: ${file}`);
}
for (const file of ['server/investigations.js','scripts/validate.mjs','scripts/test-investigations.mjs','setup/003_bootstrap_admin.sql.example','assets/banner-dark-mobile.png','assets/banner-dark-tablet.png']) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing required structured file: ${file}`);
}
for (const file of ['api/package.json','api/vercel.json','api/shared.js','api/investigation.html']) {
  if (fs.existsSync(path.join(root, file))) errors.push(`Invalid file inside API directory: ${file}`);
}
const apiFiles = fs.existsSync(path.join(root,'api')) ? fs.readdirSync(path.join(root,'api')).filter((name)=>name.endsWith('.js')) : [];
const apiBaseNames = new Map();
if (apiFiles.length > 12) errors.push(`Hobby-plan function limit exceeded: ${apiFiles.length} files in /api; maximum is 12.`);
for (const name of apiFiles) {
  if (/ \(\d+\)\.js$/.test(name)) errors.push(`Duplicate-upload filename in API directory: api/${name}`);
  const base = path.parse(name).name.toLowerCase();
  if (apiBaseNames.has(base)) errors.push(`Conflicting API function names: api/${apiBaseNames.get(base)} and api/${name}`);
  apiBaseNames.set(base, name);
}
for (const name of fs.readdirSync(root)) {
  if (/ \(\d+\)\./.test(name)) errors.push(`Duplicate-upload filename in repository root: ${name}`);
}
const publicArchiveScript = fs.readFileSync(path.join(root,'investigations.js'),'utf8');
if (/export\s+default\s+async\s+function\s+handler/.test(publicArchiveScript) || /\.\.\/server\//.test(publicArchiveScript)) errors.push('Public investigations.js was overwritten by an API function.');
const latestPublicScript = fs.readFileSync(path.join(root,'latest-investigation.js'),'utf8');
if (/export\s+default\s+async\s+function\s+handler/.test(latestPublicScript) || /\.\.\/server\//.test(latestPublicScript)) errors.push('Public latest-investigation.js was overwritten by an API function.');

if(errors.length){console.error(`Validation failed with ${errors.length} issue(s):\n- ${errors.join('\n- ')}`);process.exit(1);}
console.log(`Validation passed: ${htmlFiles.length} HTML pages, ${expected.length} required files, routes, references, and secret checks.`);
