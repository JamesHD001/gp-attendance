// scripts/migrate-students.js
// Usage: set GOOGLE_APPLICATION_CREDENTIALS or configure admin SDK, then run:
//   node scripts/migrate-students.js

const admin = require('firebase-admin');

// If you have a service account JSON file, set GOOGLE_APPLICATION_CREDENTIALS
// env var to its path before running the script. Otherwise the admin SDK will
// try Application Default Credentials.

let db;
if (!admin.apps.length) {
  try {
    let credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    // Fallback: if env var not set, look for a service account JSON in ./keys
    if (!credPath) {
      try {
        const fs = require('fs');
        const keysDir = './keys';
        if (fs.existsSync(keysDir)) {
          const files = fs.readdirSync(keysDir).filter(f => f.endsWith('.json'));
          if (files.length) {
            credPath = require('path').join(keysDir, files[0]);
            console.log('No GOOGLE_APPLICATION_CREDENTIALS; falling back to', credPath);
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (credPath) {
      console.log('Using service account from:', credPath);
      console.log('Using service account from:', credPath);
      // Load the service account JSON explicitly to ensure projectId is available
      const fs = require('fs');
      let serviceAccount = null;
      try {
        const raw = fs.readFileSync(credPath, 'utf8');
        serviceAccount = JSON.parse(raw);
      } catch (e) {
        console.warn('Could not read/parse service account JSON from', credPath, e.message || e);
      }

      if (serviceAccount) console.log('Loaded service account keys; project_id=', serviceAccount.project_id);

      // Ensure environment project vars are set for google auth fallback
      if (serviceAccount && serviceAccount.project_id) {
        process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || serviceAccount.project_id;
      }

      if (serviceAccount && serviceAccount.project_id) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id
        });
      } else if (serviceAccount) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } else {
        // Fallback to default initialization which may use ADC
        admin.initializeApp();
      }
    } else {
      admin.initializeApp();
    }
  } catch (err) {
    console.error('Failed to initialize firebase-admin. Set GOOGLE_APPLICATION_CREDENTIALS or configure ADC.', err);
    process.exit(1);
  }
}

db = admin.firestore();

async function migrate() {
  const studentsRef = db.collection('students');
  const snapshot = await studentsRef.get();
  console.log(`Found ${snapshot.size} student documents.`);
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    // Normalize class -> classId
    if ((data.class || data.class_id) && !data.classId) {
      updates.classId = data.class || data.class_id;
    }

    // Normalize joinedAt (string) -> createdAt (timestamp)
    if (data.joinedAt && !data.createdAt) {
      const parsed = new Date(data.joinedAt);
      if (!isNaN(parsed.getTime())) {
        updates.createdAt = admin.firestore.Timestamp.fromDate(parsed);
      } else {
        // If not parseable, set server timestamp so records have a createdAt
        updates.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
    }

    // Normalize phone number field name
    if (data['phone number'] && !data.phoneNumber) {
      updates.phoneNumber = data['phone number'];
    }

    // Ensure name is present
    if (!data.name && (data.fullName || data.Name)) {
      updates.name = data.fullName || data.Name;
    }

    // If any updates, apply them
    if (Object.keys(updates).length) {
      try {
        await doc.ref.update(updates);
        updated += 1;
        console.log(`Updated ${doc.id}:`, updates);
      } catch (err) {
        console.error(`Failed to update ${doc.id}:`, err);
      }
    }
  }

  console.log(`Migration complete. Documents updated: ${updated}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
