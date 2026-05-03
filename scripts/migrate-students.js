// scripts/migrate-students.js
// Usage: set GOOGLE_APPLICATION_CREDENTIALS or configure admin SDK, then run:
//   node scripts/migrate-students.js

const admin = require('firebase-admin');

// If you have a service account JSON file, set GOOGLE_APPLICATION_CREDENTIALS
// env var to its path before running the script. Otherwise the admin SDK will
// try Application Default Credentials.

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (err) {
    console.error('Failed to initialize firebase-admin. Set GOOGLE_APPLICATION_CREDENTIALS or configure ADC.', err);
    process.exit(1);
  }
}

const db = admin.firestore();

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
