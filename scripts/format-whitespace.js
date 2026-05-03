// scripts/format-whitespace.js
// Simple whitespace normalizer for project files.
// Actions:
// - Replace tab characters with two spaces
// - Trim trailing whitespace on each line
// - Collapse runs of more than two consecutive blank lines into two
// - Ensure file ends with a single newline

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTS = ['.js', '.html', '.css', '.md', '.json', '.txt'];
const IGNORE = ['node_modules', '.git', 'keys'];

function shouldProcess(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (!rel) return false;
  for (const ig of IGNORE) if (rel.split(path.sep).includes(ig)) return false;
  return EXTS.includes(path.extname(filePath).toLowerCase());
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE.includes(ent.name)) continue;
      walk(full);
    } else if (ent.isFile()) {
      if (shouldProcess(full)) processFile(full);
    }
  }
}

function processFile(filePath) {
  try {
    let src = fs.readFileSync(filePath, 'utf8');
    const original = src;
    // Normalize CRLF to LF
    src = src.replace(/\r\n/g, '\n');
    // Replace tabs with two spaces
    src = src.replace(/\t/g, '  ');
    // Trim trailing whitespace on each line
    src = src.split('\n').map(line => line.replace(/[ \t]+$/u, '')).join('\n');
    // Collapse >2 blank lines to 2
    src = src.replace(/(\n){3,}/g, '\n\n');
    // Ensure exactly one final newline
    if (!src.endsWith('\n')) src += '\n';

    if (src !== original) {
      fs.writeFileSync(filePath, src, 'utf8');
      console.log('Fixed:', path.relative(ROOT, filePath));
    }
  } catch (err) {
    console.error('Error processing', filePath, err.message || err);
  }
}

console.log('Running whitespace normalizer...');
walk(ROOT);
console.log('Done.');
