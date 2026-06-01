// Firestore Utilities Module
// Handles all Firestore database operations

import { auth, db } from '../firebase-config.js';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";
import {
  isInstructorAttendanceLocked,
  buildInstructorAttendanceLockError
} from './instructor-attendance-lock.js';

const CORE_GENERAL_CLASS_DEFINITIONS = [
  { name: 'Institute of Religion', aliases: ['Institute'] },
  { name: 'Temple & Family History', aliases: ['Family History', 'Temple and Family History'] },
  { name: 'Temple Prep', aliases: ['Temple Preparation'] },
  { name: 'Self-Reliance', aliases: ['Self Reliance'] }
];

export const CORE_GENERAL_CLASS_NAMES = CORE_GENERAL_CLASS_DEFINITIONS.map(item => item.name);

function normalizeLookupValue(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isKnownGeneralClassName(name = '') {
  const normalizedName = normalizeLookupValue(name);
  if (!normalizedName) return false;

  return CORE_GENERAL_CLASS_DEFINITIONS.some(item =>
    [item.name, ...(item.aliases || [])].some(alias => normalizeLookupValue(alias) === normalizedName)
  );
}

function normalizeSharedClassIds(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function getDateMillis(value) {
  if (!value) return 0;

  const dateValue = value.toDate ? value.toDate() : value;
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const millis = date.getTime();

  return Number.isFinite(millis) ? millis : 0;
}

function sortSessionsByDateDesc(left, right) {
  return getDateMillis(right?.date) - getDateMillis(left?.date);
}

function buildNormalizedClassRecord(id, data = {}) {
  return {
    ...data,
    id,
    name: data.name || '',
    instructorId: data.instructorId || '',
    isLocked: Boolean(data.isLocked),
    isGeneralClass: Boolean(data.isGeneralClass || isKnownGeneralClassName(data.name)),
    createdAt: data.createdAt || null
  };
}

function buildNormalizedUserRecord(id, data = {}) {
  return {
    ...data,
    id,
    name: data.name || data.fullName || '',
    email: data.email || '',
    role: data.role || '',
    assignedClassId: data.assignedClassId || data.assignedClass || null,
    phoneNumber: data.phoneNumber || data.phone || '',
    address: data.address || data.location || '',
    createdAt: data.createdAt || null
  };
}

function buildNormalizedStudentRecord(id, data = {}) {
  const normalized = Object.assign({}, data);

  normalized.id = id;
  normalized.name = data.name || data.fullName || data.Name || '';
  normalized.classId = data.classId || data.class || data.class_id || '';
  normalized.email = data.email || data.Email || '';
  normalized.location = data.location || data.Location || '';
  normalized.phoneNumber = data.phoneNumber || data['phone number'] || data.phone || '';
  normalized.createdAt = data.createdAt || data.joinedAt || null;
  normalized.sharedClassIds = normalizeSharedClassIds(
    data.sharedClassIds || data.sharedClasses || data.secondaryClassIds || []
  ).filter(classId => classId !== normalized.classId);

  return normalized;
}

function dedupeStudentsById(students = []) {
  const studentsById = new Map();

  for (const student of students) {
    if (!student?.id) continue;

    const existing = studentsById.get(student.id);
    if (!existing) {
      studentsById.set(student.id, student);
      continue;
    }

    studentsById.set(student.id, {
      ...existing,
      ...student,
      sharedClassIds: normalizeSharedClassIds([
        ...(existing.sharedClassIds || []),
        ...(student.sharedClassIds || [])
      ]).filter(classId => classId !== (student.classId || existing.classId || ''))
    });
  }

  return Array.from(studentsById.values());
}

async function ensureClassesExist(classDefinitions = []) {
  const classesRef = collection(db, "classes");
  const snapshot = await getDocs(classesRef);
  const existingDocs = snapshot.docs.map(docSnap => buildNormalizedClassRecord(docSnap.id, docSnap.data() || {}));
  const existingByName = new Map(existingDocs.map(item => [normalizeLookupValue(item.name), item]));

  let batch = writeBatch(db);
  let batchOps = 0;

  const commitBatchIfNeeded = async (force = false) => {
    if (!batchOps) return;
    if (!force && batchOps < 400) return;

    await batch.commit();
    batch = writeBatch(db);
    batchOps = 0;
  };

  for (const definition of classDefinitions) {
    const className = String(definition?.name || '').trim();
    if (!className) continue;

    const normalizedName = normalizeLookupValue(className);
    const existing = existingByName.get(normalizedName);
    const isGeneralClass = definition?.isGeneralClass ?? isKnownGeneralClassName(className);

    if (!existing) {
      const newDoc = doc(classesRef);
      batch.set(newDoc, {
        name: className,
        instructorId: "",
        isLocked: false,
        isGeneralClass: Boolean(isGeneralClass),
        createdAt: serverTimestamp()
      });
      batchOps += 1;
      existingByName.set(normalizedName, buildNormalizedClassRecord(newDoc.id, {
        name: className,
        instructorId: "",
        isLocked: false,
        isGeneralClass
      }));
      await commitBatchIfNeeded();
      continue;
    }

    if (isGeneralClass && !existing.isGeneralClass) {
      batch.set(doc(classesRef, existing.id), { isGeneralClass: true }, { merge: true });
      batchOps += 1;
      existing.isGeneralClass = true;
      await commitBatchIfNeeded();
    }
  }

  await commitBatchIfNeeded(true);
}

async function commitStudentAssignmentUpdates(studentRecords = [], buildUpdates) {
  const validStudents = Array.isArray(studentRecords)
    ? studentRecords.filter(student => student?.id)
    : [];

  let batch = writeBatch(db);
  let batchOps = 0;
  let updatedCount = 0;

  const commitBatchIfNeeded = async (force = false) => {
    if (!batchOps) return;
    if (!force && batchOps < 400) return;

    await batch.commit();
    batch = writeBatch(db);
    batchOps = 0;
  };

  for (const student of validStudents) {
    const updates = buildUpdates(buildNormalizedStudentRecord(student.id, student));
    if (!updates) continue;

    batch.set(doc(db, "students", student.id), updates, { merge: true });
    batchOps += 1;
    updatedCount += 1;

    await commitBatchIfNeeded();
  }

  await commitBatchIfNeeded(true);
  return updatedCount;
}

export function studentHasClass(student, classId) {
  if (!student || !classId) return false;
  if (student.classId === classId) return true;
  return normalizeSharedClassIds(student.sharedClassIds).includes(classId);
}

export function getStudentMembershipType(student, classId) {
  if (!studentHasClass(student, classId)) return '';
  return student.classId === classId ? 'primary' : 'shared';
}

export async function ensureGeneralClasses() {
  await ensureClassesExist(
    CORE_GENERAL_CLASS_DEFINITIONS.map(item => ({
      name: item.name,
      isGeneralClass: true
    }))
  );
}

export async function bulkAssignStudentsToClass(studentRecords = [], targetClassId, mode = 'add') {
  if (!targetClassId) {
    throw new Error('bulkAssignStudentsToClass: targetClassId is required');
  }

  return commitStudentAssignmentUpdates(studentRecords, student => {
    const sharedClassIds = normalizeSharedClassIds(student.sharedClassIds);

    if (mode === 'move') {
      const nextSharedClassIds = sharedClassIds.filter(classId => classId !== targetClassId);
      if (student.classId === targetClassId && nextSharedClassIds.length === sharedClassIds.length) {
        return null;
      }

      return {
        classId: targetClassId,
        sharedClassIds: nextSharedClassIds
      };
    }

    if (student.classId === targetClassId || sharedClassIds.includes(targetClassId)) {
      return null;
    }

    return {
      sharedClassIds: [...sharedClassIds, targetClassId]
    };
  });
}

export async function bulkRemoveStudentsFromClass(studentRecords = [], classId) {
  if (!classId) {
    throw new Error('bulkRemoveStudentsFromClass: classId is required');
  }

  return commitStudentAssignmentUpdates(studentRecords, student => {
    if (student.classId === classId) {
      return null;
    }

    const sharedClassIds = normalizeSharedClassIds(student.sharedClassIds);
    const nextSharedClassIds = sharedClassIds.filter(item => item !== classId);

    if (nextSharedClassIds.length === sharedClassIds.length) {
      return null;
    }

    return {
      sharedClassIds: nextSharedClassIds
    };
  });
}

/* ===========================
   CLASS OPERATIONS
=========================== */

export async function getClasses() {

  const classesRef = collection(db, "classes");

  const snapshot = await getDocs(classesRef);

  return snapshot.docs.map(docSnap => buildNormalizedClassRecord(docSnap.id, docSnap.data() || {}));

}

export async function getClassById(classId) {

  const classRef = doc(db, "classes", classId);

  const snapshot = await getDoc(classRef);

  if (!snapshot.exists()) return null;

  return buildNormalizedClassRecord(snapshot.id, snapshot.data() || {});

}

export async function updateClassLockStatus(classId, isLocked) {

  const classRef = doc(db, "classes", classId);

  await updateDoc(classRef, {
    isLocked
  });

}

export async function updateClassInstructor(classId, instructorId = "") {

  const classRef = doc(db, "classes", classId);

  await updateDoc(classRef, {
    instructorId: instructorId || ""
  });

}

/* ===========================
   USER OPERATIONS
=========================== */

export async function getUserRole(uid) {

  const userRef = doc(db, "users", uid);

  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) return null;

  return snapshot.data().role;

}

export async function getUserData(uid) {

  const userRef = doc(db, "users", uid);

  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) return null;

  return buildNormalizedUserRecord(snapshot.id, snapshot.data() || {});

}

export async function getAllUsers() {

  const usersRef = collection(db, "users");

  const snapshot = await getDocs(usersRef);

  return snapshot.docs.map(docSnap => buildNormalizedUserRecord(docSnap.id, docSnap.data() || {}));

}

export async function createUser(uid, email, name, role, assignedClassId = null) {

  const userRef = doc(db, "users", uid);

  const userData = {
    name,
    email,
    role,
    assignedClassId,
    createdAt: serverTimestamp()
  };

  await setDoc(userRef, userData);

}

export async function updateUser(uid, updates) {

  const userRef = doc(db, "users", uid);

  await updateDoc(userRef, updates);

}

export async function deleteUser(uid) {

  const userRef = doc(db, "users", uid);

  await deleteDoc(userRef);

}

/* ===========================
   STUDENT OPERATIONS
=========================== */

export async function getStudents() {

  const studentsRef = collection(db, "students");

  const snapshot = await getDocs(studentsRef);

  return snapshot.docs.map(docSnap => buildNormalizedStudentRecord(docSnap.id, docSnap.data() || {}));

}

export async function getStudentsByClass(classId) {
  if (!classId) return [];

  const studentsRef = collection(db, "students");

  const primaryClassQuery = query(
    studentsRef,
    where("classId", "==", classId)
  );
  const sharedClassQuery = query(
    studentsRef,
    where("sharedClassIds", "array-contains", classId)
  );

  const [primarySnapshot, sharedSnapshot] = await Promise.all([
    getDocs(primaryClassQuery),
    getDocs(sharedClassQuery)
  ]);

  return dedupeStudentsById([
    ...primarySnapshot.docs.map(docSnap => buildNormalizedStudentRecord(docSnap.id, docSnap.data() || {})),
    ...sharedSnapshot.docs.map(docSnap => buildNormalizedStudentRecord(docSnap.id, docSnap.data() || {}))
  ]);

}

export async function addStudent(name, classId, email = null, phoneNumber = null, location = null, joinedAt = null) {

  const studentsRef = collection(db, "students");

  const studentData = {
    name,
    classId,
    sharedClassIds: [],
    createdAt: joinedAt ? Timestamp.fromDate(new Date(joinedAt)) : serverTimestamp()
  };

  if (email) studentData.email = email;
  if (phoneNumber) studentData.phoneNumber = phoneNumber;
  if (location) studentData.location = location;

  if (!name || !classId) {
    throw new Error('addStudent: name and classId are required');
  }

  try {
    const docRef = await addDoc(studentsRef, studentData);
    return docRef.id;
  } catch (err) {
    console.error('addStudent failed', { name, classId, email, phoneNumber, location, joinedAt }, err);
    throw err;
  }

}

export async function updateStudent(studentId, updates) {

  if (!studentId) throw new Error('updateStudent: missing studentId');
  const studentRef = doc(db, "students", studentId);
  const normalizedUpdates = { ...updates };
  if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'sharedClassIds')) {
    normalizedUpdates.sharedClassIds = normalizeSharedClassIds(normalizedUpdates.sharedClassIds);
  }
  // Use setDoc with merge to be tolerant of missing documents and create/merge fields
  await setDoc(studentRef, normalizedUpdates, { merge: true });

}

export async function deleteStudent(studentId) {

  if (!studentId) throw new Error('deleteStudent: missing studentId');
  const studentRef = doc(db, "students", studentId);
  await deleteDoc(studentRef);

}

export async function deleteClass(classId) {
  if (!classId) throw new Error('deleteClass: missing classId');
  const classRef = doc(db, "classes", classId);
  await deleteDoc(classRef);
}

/* ===========================
   ATTENDANCE SESSIONS
=========================== */

export async function createAttendanceSession(classId, date, createdBy, summary = null) {

  const sessionsRef = collection(db, "attendanceSessions");

  const sessionData = {
    classId,
    date: Timestamp.fromDate(new Date(date)),
    createdBy,
    createdAt: serverTimestamp()
  };

  // Support an optional summary payload for general (GP) attendance
  if (summary && typeof summary === 'object') {
    if (typeof summary.present === 'number') sessionData.summaryPresent = Number(summary.present);
    if (typeof summary.absent === 'number') sessionData.summaryAbsent = Number(summary.absent);
    if (typeof summary.total === 'number') sessionData.summaryTotal = Number(summary.total);
    sessionData.isGeneral = true;
  }

  const docRef = await addDoc(sessionsRef, sessionData);

  return docRef.id;

}

export async function getSessionsByClass(classId) {
  if (!classId) return [];

  const sessionsRef = collection(db, "attendanceSessions");

  const q = query(
    sessionsRef,
    where("classId", "==", classId)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map(doc => {
      const d = doc.data() || {};
      return Object.assign({}, d, { id: doc.id });
    })
    .sort(sortSessionsByDateDesc);

}

export async function getSessionById(sessionId) {

  const sessionRef = doc(db, "attendanceSessions", sessionId);

  const snapshot = await getDoc(sessionRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data()
  };

}

export async function deleteAttendanceSession(sessionId) {
  if (!sessionId) {
    throw new Error('deleteAttendanceSession: sessionId is required');
  }

  await assertInstructorAttendanceWindowOpenForCurrentUser();

  const recordsRef = collection(db, "attendanceRecords");
  const recordsQuery = query(recordsRef, where("sessionId", "==", sessionId));
  const recordsSnapshot = await getDocs(recordsQuery);

  for (let i = 0; i < recordsSnapshot.docs.length; i += 450) {
    const batch = writeBatch(db);
    recordsSnapshot.docs.slice(i, i + 450).forEach(recordDoc => {
      batch.delete(recordDoc.ref);
    });
    await batch.commit();
  }

  const sessionRef = doc(db, "attendanceSessions", sessionId);

  await deleteDoc(sessionRef);

}

/* ===========================
   ATTENDANCE RECORDS
=========================== */

export async function saveAttendanceRecord(sessionId, studentId, status) {

  await assertInstructorAttendanceWindowOpenForCurrentUser();

  const recordsRef = collection(db, "attendanceRecords");

  const q = query(
    recordsRef,
    where("sessionId", "==", sessionId),
    where("studentId", "==", studentId)
  );

  const snapshot = await getDocs(q);

  if (!snapshot.empty) {

    const existingDoc = snapshot.docs[0];

    await updateDoc(
      doc(db, "attendanceRecords", existingDoc.id),
      { status }
    );

    return existingDoc.id;

  } else {

    const recordData = {
      sessionId,
      studentId,
      status,
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(recordsRef, recordData);

    return docRef.id;

  }

}

export async function getAttendanceBySession(sessionId) {

  const recordsRef = collection(db, "attendanceRecords");

  const q = query(
    recordsRef,
    where("sessionId", "==", sessionId)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

}

// Get attendance records for multiple sessions in batch (avoids N+1 reads)
async function getAttendanceRecordsBySessionIds(sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return {};
  }

  const recordsRef = collection(db, "attendanceRecords");
  const sessionsChunkSize = 30; // Firestore `in` query max values
  const recordsBySession = {};

  for (let i = 0; i < sessionIds.length; i += sessionsChunkSize) {
    const chunk = sessionIds.slice(i, i + sessionsChunkSize);
    const q = query(recordsRef, where("sessionId", "in", chunk));
    const snapshot = await getDocs(q);

    for (const recordDoc of snapshot.docs) {
      const record = { id: recordDoc.id, ...recordDoc.data() };
      if (!recordsBySession[record.sessionId]) {
        recordsBySession[record.sessionId] = [];
      }
      recordsBySession[record.sessionId].push(record);
    }
  }

  return recordsBySession;
}

/* ===========================
   PERFORMANCE / RECOMMENDATIONS
=========================== */

function buildPerformanceRecordId(classId, studentId, instructorId) {
  return `${classId}__${studentId}__${instructorId}`;
}

export async function savePerformanceRating({
  classId,
  studentId,
  instructorId,
  rating,
  recommendation = '',
  studentName = ''
}) {
  const recordId = buildPerformanceRecordId(classId, studentId, instructorId);
  const performanceRef = doc(db, 'performanceRatings', recordId);

  await setDoc(performanceRef, {
    classId,
    studentId,
    instructorId,
    studentName,
    rating: Number(rating),
    recommendation: recommendation.trim(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  return recordId;
}

export async function getPerformanceRatingsByClass(classId) {
  const performanceRef = collection(db, 'performanceRatings');
  const q = query(performanceRef, where('classId', '==', classId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

export async function getPerformanceRatingForStudent(classId, studentId, instructorId) {
  const recordId = buildPerformanceRecordId(classId, studentId, instructorId);
  const performanceRef = doc(db, 'performanceRatings', recordId);
  const snapshot = await getDoc(performanceRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

function buildStudentPerformanceMap(performanceRatings) {
  return performanceRatings.reduce((acc, item) => {
    acc[item.studentId] = item;
    return acc;
  }, {});
}

function calculateGraduationScore(attendanceRate, performanceRating) {
  const normalizedPerformance = Math.max(0, Math.min(100, Math.round((Number(performanceRating || 0) / 5) * 100)));
  const graduationRate = Math.round((attendanceRate * 0.7) + (normalizedPerformance * 0.3));

  return {
    normalizedPerformance,
    graduationRate
  };
}

/* ===========================
   INITIALIZE DEFAULT GP CLASSES
=========================== */

export async function initializeClasses() {
  const defaultClasses = [
    "ICT",
    "Barbing",
    "Bag Making",
    "Catering",
    "Fashion/Tailoring",
    "Makeup/Facial Stylists",
    "Hair Making/Dressing",
    "Self-Reliance",
    "Temple & Family History",
    "Mission Preparation",
    "BYU Pathway",
    "Guest",
    "Institute of Religion",
    "Temple Prep",
    "Shoe Making"
  ];

  await ensureClassesExist(
    defaultClasses.map(className => ({
      name: className,
      isGeneralClass: isKnownGeneralClassName(className)
    }))
  );

}

/* ===========================
   HELPERS / COMPATIBILITY WRAPPERS
   These provide the function names expected by other modules
   and a simple attendance statistics helper used by dashboards.
=========================== */

// Create a session and optionally save records
export async function createSession(payload) {
  // payload: { class: classId, date, records: [{ studentId, status, name }] , createdBy }
  const classId = payload.class || payload.classId;
  const date = payload.date || new Date().toISOString();
  const createdBy = payload.createdBy || (payload.createdBy === undefined ? '' : payload.createdBy);

  // Support general summary payloads (admin marking general attendance)
  const generalSummary = payload.generalSummary || payload.summary || null;

  await assertInstructorAttendanceWindowOpenForCurrentUser(createdBy || auth.currentUser?.uid || null);

  const sessionsRef = collection(db, "attendanceSessions");
  const sessionRef = doc(sessionsRef);
  const sessionId = sessionRef.id;

  const sessionData = {
    classId,
    date: Timestamp.fromDate(new Date(date)),
    createdBy,
    createdAt: serverTimestamp()
  };

  if (generalSummary && typeof generalSummary === 'object') {
    if (typeof generalSummary.present === 'number') sessionData.summaryPresent = Number(generalSummary.present);
    if (typeof generalSummary.absent === 'number') sessionData.summaryAbsent = Number(generalSummary.absent);
    if (typeof generalSummary.total === 'number') sessionData.summaryTotal = Number(generalSummary.total);
    sessionData.isGeneral = true;
  }

  // IMPORTANT:
  // Attendance session must be created BEFORE attendance records.
  // Firestore security rules validate attendance records against an
  // existing session document. Batched writes caused permission errors
  // because the session document was not yet available during validation.

  await setDoc(sessionRef, sessionData);

  if (Array.isArray(payload.records) && payload.records.length) {
    const recordsRef = collection(db, "attendanceRecords");

    for (const r of payload.records) {
      const studentId = r.studentId || r.id;
      const status = r.status || 'absent';

      if (!studentId) continue;

      const recordRef = doc(recordsRef);

      await setDoc(recordRef, {
        sessionId,
        studentId,
        status,
        createdAt: serverTimestamp()
      });
    }
  }

  return sessionId;

}

// Update a single attendance record (compat wrapper)
export async function updateAttendance(sessionId, studentId, status) {
  return await saveAttendanceRecord(sessionId, studentId, status);
}

// Delete session wrapper
export async function deleteSession(sessionId) {
  return await deleteAttendanceSession(sessionId);
}

async function assertInstructorAttendanceWindowOpenForCurrentUser(explicitUserId = null) {
  const userId = explicitUserId || auth.currentUser?.uid || null;
  if (!userId) return;

  let role = null;
  try {
    role = await getUserRole(userId);
  } catch (error) {
    console.warn('Attendance lock role lookup failed:', error);
    return;
  }

  if (role !== 'instructor') return;
  if (!isInstructorAttendanceLocked(new Date())) return;

  throw buildInstructorAttendanceLockError(new Date());
}

// Calculate attendance statistics for a class
export async function calculateAttendanceStats(classId) {
  const students = await getStudentsByClass(classId);
  const sessions = await getSessionsByClass(classId);
  const recordsBySession = await getAttendanceRecordsBySessionIds(
    sessions.map(session => session.id)
  );

  const studentStats = {};

  // Initialize
  for (const s of students) {
    studentStats[s.id] = {
      name: s.name,
      present: 0,
      absent: 0,
      total: 0,
      attendanceRate: 0
    };
  }

  for (const session of sessions) {
    const records = recordsBySession[session.id] || [];
    for (const r of records) {
      const st = studentStats[r.studentId];
      if (!st) continue;
      st.total += 1;
      if (r.status === 'present') st.present += 1;
      else st.absent += 1;
    }
  }

  // Compute rates
  for (const k of Object.keys(studentStats)) {
    const s = studentStats[k];
    s.attendanceRate = s.total === 0 ? 0 : Math.round((s.present / s.total) * 100);
  }

  return {
    totalStudents: students.length,
    totalSessions: sessions.length,
    studentStats
  };

}

export async function calculateGraduationStats(classId) {
  const [attendanceStats, performanceRatings, classData] = await Promise.all([
    calculateAttendanceStats(classId),
    getPerformanceRatingsByClass(classId),
    getClassById(classId)
  ]);

  const performanceByStudent = buildStudentPerformanceMap(performanceRatings);
  const studentGraduationStats = {};
  let graduationTotal = 0;
  let performanceCount = 0;

  for (const [studentId, attendance] of Object.entries(attendanceStats.studentStats)) {
    const performance = performanceByStudent[studentId] || null;
    const performanceRating = Number(performance?.rating || 0);
    const { normalizedPerformance, graduationRate } = calculateGraduationScore(
      attendance.attendanceRate,
      performanceRating
    );

    if (performance) {
      performanceCount += 1;
    }

    graduationTotal += graduationRate;

    studentGraduationStats[studentId] = {
      studentId,
      name: attendance.name,
      attendanceRate: attendance.attendanceRate,
      attendancePresent: attendance.present,
      attendanceAbsent: attendance.absent,
      attendanceTotal: attendance.total,
      performanceRating,
      performanceScore: normalizedPerformance,
      recommendation: performance?.recommendation || '',
      graduationRate
    };
  }

  const studentsCount = Object.keys(studentGraduationStats).length;
  const averageGraduationRate = studentsCount === 0
    ? 0
    : Math.round(graduationTotal / studentsCount);

  return {
    classId,
    className: classData?.name || classId,
    totalStudents: attendanceStats.totalStudents,
    totalSessions: attendanceStats.totalSessions,
    ratedStudents: performanceCount,
    averageGraduationRate,
    studentGraduationStats
  };
}

export async function getGraduationOverview(classIds = []) {
  const statsList = await Promise.all(classIds.map(classId => calculateGraduationStats(classId)));

  const totalStudents = statsList.reduce((sum, item) => sum + item.totalStudents, 0);
  const ratedStudents = statsList.reduce((sum, item) => sum + item.ratedStudents, 0);
  const overallAverage = statsList.length === 0
    ? 0
    : Math.round(statsList.reduce((sum, item) => sum + item.averageGraduationRate, 0) / statsList.length);

  return {
    totalClasses: statsList.length,
    totalStudents,
    ratedStudents,
    overallAverage,
    classes: statsList
  };
}

export async function createClass(name, options = {}) {
  const className = String(name || '').trim();
  if (!className) {
    throw new Error('createClass: name is required');
  }

  const classesRef = collection(db, "classes");

  const docRef = await addDoc(classesRef, {
    name: className,
    instructorId: "",
    isLocked: false,
    isGeneralClass: options?.isGeneralClass ?? isKnownGeneralClassName(className),
    createdAt: serverTimestamp()
  });

  return docRef.id;

}

/* ===========================
   ADVANCED ANALYTICS HELPERS
=========================== */

// Get attendance stats grouped by time period (weekly, monthly, annually)
export async function getAttendanceByTimePeriod(classId, period = 'weekly') {
  const students = await getStudentsByClass(classId);
  const sessions = await getSessionsByClass(classId);
  const now = new Date();

  let filteredSessions = sessions;

  if (period === 'weekly') {
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filteredSessions = sessions.filter(s => getDateMillis(s.date) >= oneWeekAgo.getTime());
  } else if (period === 'monthly') {
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    filteredSessions = sessions.filter(s => getDateMillis(s.date) >= oneMonthAgo.getTime());
  } else if (period === 'annually') {
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    filteredSessions = sessions.filter(s => getDateMillis(s.date) >= oneYearAgo.getTime());
  }

  const studentStats = {};
  for (const s of students) {
    studentStats[s.id] = {
      name: s.name,
      present: 0,
      absent: 0,
      total: 0,
      attendanceRate: 0
    };
  }

  const recordsBySession = await getAttendanceRecordsBySessionIds(
    filteredSessions.map(session => session.id)
  );

  for (const session of filteredSessions) {
    const records = recordsBySession[session.id] || [];
    for (const r of records) {
      const st = studentStats[r.studentId];
      if (!st) continue;
      st.total += 1;
      if (r.status === 'present') st.present += 1;
      else st.absent += 1;
    }
  }

  for (const k of Object.keys(studentStats)) {
    const s = studentStats[k];
    s.attendanceRate = s.total === 0 ? 0 : Math.round((s.present / s.total) * 100);
  }

  return {
    period,
    totalStudents: students.length,
    totalSessions: filteredSessions.length,
    studentStats
  };
}

// Get overall gathering place attendance stats
export async function getGatheringPlaceStats() {
  const classes = await getClasses();
  const students = await getStudents();
  const sessionsRef = collection(db, "attendanceSessions");
  const sessionsSnapshot = await getDocs(sessionsRef);
  const sessions = sessionsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  const recordsRef = collection(db, "attendanceRecords");
  const recordsSnapshot = await getDocs(recordsRef);
  const records = recordsSnapshot.docs.map(doc => doc.data());

  // Base counts from individual attendance records
  let totalPresent = records.filter(r => r.status === 'present').length;
  let totalAbsent = records.filter(r => r.status === 'absent').length;
  let totalRecords = records.length;

  // Include summary counts stored on general sessions (session-level summaries)
  for (const s of sessions) {
    if (s && s.isGeneral) {
      if (typeof s.summaryPresent === 'number') {
        totalPresent += Number(s.summaryPresent);
      }
      if (typeof s.summaryAbsent === 'number') {
        totalAbsent += Number(s.summaryAbsent);
      }
      if (typeof s.summaryTotal === 'number') {
        totalRecords += Number(s.summaryTotal);
      }
    }
  }

  const overallRate = totalRecords === 0 ? 0 : Math.round((totalPresent / totalRecords) * 100);

  return {
    totalClasses: classes.length,
    totalStudents: students.length,
    totalSessions: sessions.length,
    totalPresent,
    totalAbsent,
    totalRecords,
    overallRate
  };
}

export async function getGeneralSessions() {
  const sessionsRef = collection(db, 'attendanceSessions');
  const q = query(sessionsRef, where('isGeneral', '==', true));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort(sortSessionsByDateDesc);
}

// Get next scheduled class dates based on gathering place schedule
export function getNextClassDates(daysAhead = 30) {
  const schedule = {
    'Wednesday': { type: 'Gathering Place Classes', classes: ['All Skill Classes', 'Institute of Religion', 'Family History & Temple Preparation', 'Other General Classes'] },
    'Friday': { type: 'Gathering Place Classes', classes: ['All Skill Classes', 'Institute of Religion', 'Family History & Temple Preparation', 'Other General Classes'] }
  };

  const nextDates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < daysAhead; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

    if (schedule[dayName]) {
      nextDates.push({
        date: date.toISOString().split('T')[0],
        dayName,
        type: schedule[dayName].type,
        classes: schedule[dayName].classes
      });
    }
  }

  return nextDates.slice(0, 4); // Return next 4 scheduled dates
}
