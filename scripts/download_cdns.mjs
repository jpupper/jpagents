import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(__dirname, 'public', 'lib');
const HTML_PATH = path.join(__dirname, 'public', 'index.html');

if (!fs.existsSync(LIB_DIR)) fs.mkdirSync(LIB_DIR, { recursive: true });

// ─── Helper: download file ───
async function download(url, dest) {
  const destPath = path.join(LIB_DIR, dest);
  // Skip if already exists (allow re-run)
  if (fs.existsSync(destPath)) {
    console.log(`  ⏭️  ${dest} already exists, skipping`);
    return;
  }
  console.log(`  ⬇️  ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const buf = await resp.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buf));
  console.log(`  ✅ ${dest} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
}

// ─── Helper: download text (for CSS processing) ───
async function downloadText(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return await resp.text();
}

// ─── 1. Download JS libraries ───
console.log('\n📦 Downloading JS libraries...\n');

const jsDownloads = [
  ['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js', 'highlight.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/dos.min.js', 'highlight-dos.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js', 'd3.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.2.0/diff.min.js', 'diff.min.js'],
  ['https://cdn.jsdelivr.net/npm/marked/marked.min.js', 'marked.min.js'],
];

for (const [url, dest] of jsDownloads) {
  try {
    await download(url, dest);
  } catch (e) {
    console.error(`  ❌ Failed to download ${dest}: ${e.message}`);
  }
}

// ─── 2. Download highlight.js CSS theme ───
console.log('\n📦 Downloading highlight.js theme...\n');
try {
  await download(
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css',
    'github-dark.min.css'
  );
} catch (e) {
  console.error(`  ❌ Failed to download highlight theme: ${e.message}`);
}

// ─── 3. Download Google Fonts Outfit ───
console.log('\n📦 Downloading Google Fonts (Outfit)...\n');

try {
  // Step 1: Download the Google Fonts CSS
  const fontCssUrl = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap';
  let fontCss = await downloadText(fontCssUrl);
  
  // Step 2: Extract font file URLs from CSS
  const fontUrlRegex = /url\((https:\/\/[^)]+)\)/g;
  let match;
  let i = 0;
  
  while ((match = fontUrlRegex.exec(fontCss)) !== null) {
    const fontUrl = match[1];
    // Determine file extension from URL
    const extMatch = fontUrl.match(/\.(woff2?)$/);
    const ext = extMatch ? extMatch[1] : 'woff2';
    const filename = `outfit-${i}.${ext}`;
    
    await download(fontUrl, filename);
    
    // Replace URL in CSS with local path
    fontCss = fontCss.replace(fontUrl, `url('./${filename}')`);
    i++;
  }
  
  // Step 3: Also handle older format URLs
  const oldUrlRegex = /url\((https:\/\/[^)]+)\)/g;
  while ((match = oldUrlRegex.exec(fontCss)) !== null) {
    const fontUrl = match[1];
    // If it still has a remote URL (shouldn't happen after replacement), handle it
    if (fontUrl.startsWith('http')) {
      const extMatch = fontUrl.match(/\.(woff2?)$/);
      const ext = extMatch ? extMatch[1] : 'woff2';
      const filename = `outfit-extra-${i}.${ext}`;
      await download(fontUrl, filename);
      fontCss = fontCss.replace(fontUrl, `url('./${filename}')`);
      i++;
    }
  }

  // Step 4: Add local-display swap fallback and save
  fontCss = fontCss.replace(/@font-face {/g, '@font-face {\n  font-display: swap;');
  
  // Remove the display=swap query param reference since we're adding it inline
  const localFontCss = fontCss;
  fs.writeFileSync(path.join(LIB_DIR, 'outfit.css'), localFontCss);
  console.log(`  ✅ outfit.css saved (${localFontCss.length} chars, ${i} fonts)`);
  
} catch (e) {
  console.error(`  ❌ Failed to download Google Fonts: ${e.message}`);
}

// ─── 4. Update index.html ───
console.log('\n📝 Updating index.html...\n');

let html = fs.readFileSync(HTML_PATH, 'utf8');

const replacements = [
  // Google Fonts preconnect + link → local CSS
  [
    /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit:[^"]+" rel="stylesheet">/,
    `<link rel="stylesheet" href="lib/outfit.css">`
  ],
  // highlight.js CSS theme
  [
    /<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/highlight\.js\/[^/]+\/styles\/github-dark\.min\.css">/,
    `<link rel="stylesheet" href="lib/github-dark.min.css">`
  ],
  // highlight.js core
  [
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/highlight\.js\/[^/]+\/highlight\.min\.js"><\/script>/,
    `<script src="lib/highlight.min.js"></script>`
  ],
  // highlight.js DOS language
  [
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/highlight\.js\/[^/]+\/languages\/dos\.min\.js"><\/script>/,
    `<script src="lib/highlight-dos.min.js"></script>`
  ],
  // D3.js
  [
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/[^/]+\/d3\.min\.js"><\/script>/,
    `<script src="lib/d3.min.js"></script>`
  ],
  // jsdiff
  [
    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jsdiff\/[^/]+\/diff\.min\.js"><\/script>/,
    `<script src="lib/diff.min.js"></script>`
  ],
  // marked
  [
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/marked\/marked\.min\.js"><\/script>/,
    `<script src="lib/marked.min.js"></script>`
  ],
];

let changedCount = 0;
for (const [pattern, replacement] of replacements) {
  const before = html;
  html = html.replace(pattern, replacement);
  if (html !== before) {
    changedCount++;
    console.log(`  ✅ Replaced: ${replacement.substring(0, 60)}...`);
  } else {
    console.log(`  ❌ Pattern not found for: ${replacement.substring(0, 60)}...`);
  }
}

fs.writeFileSync(HTML_PATH, html);
console.log(`\n  ✅ index.html updated (${changedCount}/${replacements.length} replacements)`);

// ─── Summary ───
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ CDN → LOCAL migration complete');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// List files in lib
const files = fs.readdirSync(LIB_DIR).filter(f => f !== '.gitkeep');
console.log('Files in public/lib/:');
for (const f of files) {
  const stat = fs.statSync(path.join(LIB_DIR, f));
  console.log(`  ${(stat.size / 1024).toFixed(1)} KB  ${f}`);
}
