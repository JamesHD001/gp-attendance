#!/usr/bin/env node
// Simple script to generate js/modules/firebase-config.local.js from a .env file
// Usage: node scripts/generate-firebase-config.js

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found at project root. Create a .env file with FIREBASE_* variables.');
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');
const lines = raw.split(/\r?\n/);
const env = {};
for (const line of lines) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) {
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
}

const config = {
  apiKey: env.FIREBASE_API_KEY || '',
  authDomain: env.FIREBASE_AUTH_DOMAIN || '',
  projectId: env.FIREBASE_PROJECT_ID || '',
  storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.FIREBASE_APP_ID || '',
  measurementId: env.FIREBASE_MEASUREMENT_ID || ''
};

const out = `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;

const outPath = path.resolve(process.cwd(), 'js/modules/firebase-config.local.js');
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath);
