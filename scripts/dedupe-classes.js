#!/usr/bin/env node
/**
 * Deduplicate Firestore `classes` documents by name.
 *
 * Usage:
 * 1. Create a Google service account key for your Firebase project and download the JSON file.
 * 2. Set the environment variable `SERVICE_ACCOUNT_PATH` to the JSON file path,
 *    or set `GOOGLE_APPLICATION_CREDENTIALS`.
 * 3. Run: `node scripts/dedupe-classes.js`
 *
 * The script will keep the oldest document (by `createdAt` when available) and delete others
 * that have the same case-insensitive trimmed name.
 */

const admin = require('firebase-admin');
const path = require('path');

let serviceAccountPathRaw = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
// Normalize and trim possible surrounding quotes/whitespace from user-provided paths
const serviceAccountPath = String(serviceAccountPathRaw).trim().replace(/^['"]|['"]$/g, '');

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

function getMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : 0;
}

async function dedupeClasses() {
  const classesRef = db.collection('classes');
  const snapshot = await classesRef.get();

  if (snapshot.empty) {
    console.log('No classes found.');
    return;
  }

  const groups = Object.create(null);

  snapshot.forEach(doc => {
    const data = doc.data();
    const name = (data && data.name) ? String(data.name).trim() : '';
    const key = name.toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: doc.id, data });
  });

  let totalDeleted = 0;

  for (const key of Object.keys(groups)) {
    const group = groups[key];
    if (group.length <= 1) continue;

    // Keep the oldest doc if possible (by createdAt), otherwise first
    group.sort((a, b) => getMillis(a.data.createdAt) - getMillis(b.data.createdAt));
    const keep = group[0];
    const toDelete = group.slice(1);

    console.log(`Keeping ${keep.id} (${keep.data.name || ''}), deleting ${toDelete.length} duplicate(s)`);

    for (const d of toDelete) {
      try {
        await classesRef.doc(d.id).delete();
        totalDeleted++;
      } catch (err) {
        console.error(`Failed to delete ${d.id}:`, err.message || err);
      }
    }
  }

  console.log(`Done. Deleted ${totalDeleted} duplicate class document(s).`);
}

dedupeClasses()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error running dedupe:', err.message || err);
    process.exit(1);
  });
