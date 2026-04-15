#!/usr/bin/env node
const admin = require('firebase-admin');
const path = require('path');

const raw = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
const serviceAccountPath = String(raw).trim().replace(/^['"]|['"]$/g, '');

if (!serviceAccountPath) {
  console.error('Service account JSON path not provided. Set SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.');
  process.exit(1);
}

try {
  const serviceAccount = require(path.resolve(serviceAccountPath));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err.message || err);
  process.exit(1);
}

const db = admin.firestore();

async function addClass(name) {
  const classesRef = db.collection('classes');
  const docRef = await classesRef.add({
    name,
    instructorId: '',
    isLocked: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Created class', docRef.id, '->', name);
}

const className = process.argv.slice(2).join(' ') || 'Bag Making';

addClass(className)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error creating class:', err.message || err);
    process.exit(1);
  });
