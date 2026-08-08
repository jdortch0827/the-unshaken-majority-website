import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const errors = [];
const expected = [
  'index.html','investigations.html','investigation.html','standards.html','submit.html','contact.html','correction.html','privacy.html','404.html',
  'admin-login.html','admin-investigations.html','admin-investigation-editor.html','admin-preview.html','admin.js','admin.css',
  'api/investigations.js','api/investigation.js','api/investigation-page.js','api/latest-investigation.js','api/admin-session.js','api/admin-investigations.js','api/admin-investigation.js','api/admin-evidence.js','api/admin-corrections.js','api/prepare-correction.js','api/finalize-correction.js',
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
for(const route of ['/investigations/:slug','/admin/login','/admin/investigations','/admin/investigations/new','/admin/investigations/:id/edit','/admin/investigations/:id/preview','/sitemap.xml']){
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

if(errors.length){console.error(`Validation failed with ${errors.length} issue(s):\n- ${errors.join('\n- ')}`);process.exit(1);}
console.log(`Validation passed: ${htmlFiles.length} HTML pages, ${expected.length} required files, routes, references, and secret checks.`);
