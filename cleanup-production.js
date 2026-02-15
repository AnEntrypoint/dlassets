#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const files = [
  'cleanup-and-complete.js',
  'cleanup-files.js',
  'cleanup.sh',
  'consumption-report.json',
  'converter.js',
  'debug-page-content.html',
  'debug-page-no-blocking.html',
  'do-cleanup.js',
  'execute-cleanup.js',
  'phase1-count.png',
  'phase7-final.png',
  'run-cleanup.sh',
  'asset-investigation-report.json',
  'cache-stats.json'
];

const base = '/c/usdz';
let count = 0;

files.forEach(f => {
  const p = path.join(base, f);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`deleted: ${f}`);
      count++;
    }
  } catch(e) {}
});

console.log(`\ntotal: ${count}`);
console.log('done');
