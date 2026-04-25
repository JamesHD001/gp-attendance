const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, collection, addDoc, Timestamp } = require('firebase/firestore');

async function run() {
  const projectId = 'gp-attendance-test';
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });

  try {
    console.log('Seeding data (security rules disabled)...');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'classes', 'class1'), {
        name: 'Test Class',
        instructorId: 'instructor1',
        isLocked: false,
        createdAt: Timestamp.now()
      });

      await setDoc(doc(adminDb, 'users', 'adminUid'), {
        name: 'Admin',
        email: 'admin@example.test',
        role: 'admin',
        assignedClassId: null,
        createdAt: Timestamp.now()
      });

      await setDoc(doc(adminDb, 'users', 'instructor1'), {
        name: 'Instructor',
        email: 'inst@example.test',
        role: 'instructor',
        assignedClassId: 'class1',
        createdAt: Timestamp.now()
      });
    });

    const adminContext = testEnv.authenticatedContext('adminUid');
    const adminDb = adminContext.firestore();

    console.log('Attempt: admin create user');
    try {
      await assertSucceeds(setDoc(doc(adminDb, 'users', 'u1'), { name: 'User One', email: 'u1@test', role: 'leader', createdAt: Timestamp.now() }));
      console.log('OK: admin create user');
    } catch (e) {
      console.error('ERROR: admin create user failed', e);
      throw e;
    }

    const instructorContext = testEnv.authenticatedContext('instructor1');
    const instructorDb = instructorContext.firestore();

    const sessionData = { classId: 'class1', date: Timestamp.now(), createdBy: 'instructor1', createdAt: Timestamp.now() };

    console.log('Attempt: instructor create session for class1');
    try {
      await assertSucceeds(addDoc(collection(instructorDb, 'attendanceSessions'), sessionData));
      console.log('OK: instructor create session for class1');
    } catch (e) {
      console.error('ERROR: instructor create session failed', e);
      throw e;
    }

    console.log('Attempt: instructor create session for other class (should fail)');
    try {
      await assertFails(addDoc(collection(instructorDb, 'attendanceSessions'), { classId: 'other', date: Timestamp.now(), createdBy: 'instructor1' }));
      console.log('OK: prevented creating session for other class');
    } catch (e) {
      console.error('ERROR: instructor create other class session behaved unexpectedly', e);
      throw e;
    }

    console.log('Creating a session in security-disabled mode for attendanceRecords tests');
    let sessionRef;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const docRef = await addDoc(collection(db, 'attendanceSessions'), sessionData);
      sessionRef = docRef;
    });

    console.log('Attempt: instructor create attendance record');
    try {
      await assertSucceeds(addDoc(collection(instructorDb, 'attendanceRecords'), { sessionId: sessionRef.id, studentId: 's1', status: 'present', createdAt: Timestamp.now() }));
      console.log('OK: instructor create attendance record');
    } catch (e) {
      console.error('ERROR: instructor create attendance record failed', e);
      throw e;
    }

    console.log('Attempt: invalid attendance status (should fail)');
    try {
      await assertFails(addDoc(collection(instructorDb, 'attendanceRecords'), { sessionId: sessionRef.id, studentId: 's2', status: 'late' }));
      console.log('OK: invalid status rejected');
    } catch (e) {
      console.error('ERROR: invalid status test failed', e);
      throw e;
    }

    console.log('Attempt: instructor save performance rating');
    try {
      await assertSucceeds(setDoc(doc(instructorDb, 'performanceRatings', 'class1__student1__instructor1'), {
        classId: 'class1',
        studentId: 'student1',
        instructorId: 'instructor1',
        studentName: 'Student One',
        rating: 4,
        recommendation: 'Consistent learner',
        updatedAt: Timestamp.now()
      }));
      console.log('OK: instructor saved performance rating');
    } catch (e) {
      console.error('ERROR: instructor save performance rating failed', e);
      throw e;
    }

    console.log('Attempt: instructor save invalid performance rating (should fail)');
    try {
      await assertFails(setDoc(doc(instructorDb, 'performanceRatings', 'class1__student2__instructor1'), {
        classId: 'class1',
        studentId: 'student2',
        instructorId: 'instructor1',
        studentName: 'Student Two',
        rating: 6,
        recommendation: 'Out of bounds',
        updatedAt: Timestamp.now()
      }));
      console.log('OK: invalid performance rating rejected');
    } catch (e) {
      console.error('ERROR: invalid performance rating test failed', e);
      throw e;
    }

    console.log('All rule tests completed successfully.');

  } catch (err) {
    console.error('Rule test failed:', err);
    process.exitCode = 1;
  } finally {
    await testEnv.cleanup();
  }
}

run();
