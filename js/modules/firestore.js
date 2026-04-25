// Firestore Utilities Module
// Handles all Firestore database operations

import { db } from '../firebase-config.js';

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
  orderBy,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";


/* ===========================
   CLASS OPERATIONS
=========================== */

export async function getClasses() {

  const classesRef = collection(db, "classes");

  const snapshot = await getDocs(classesRef);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

}


export async function getClassById(classId) {

  const classRef = doc(db, "classes", classId);

  const snapshot = await getDoc(classRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data()
  };

}


export async function updateClassLockStatus(classId, isLocked) {

  const classRef = doc(db, "classes", classId);

  await updateDoc(classRef, {
    isLocked
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

  return {
    id: snapshot.id,
    ...snapshot.data()
  };

}


export async function getAllUsers() {

  const usersRef = collection(db, "users");

  const snapshot = await getDocs(usersRef);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

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

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

}


export async function getStudentsByClass(classId) {

  const studentsRef = collection(db, "students");

  const q = query(
    studentsRef,
    where("classId", "==", classId)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

}


export async function addStudent(name, classId, email = null) {

  const studentsRef = collection(db, "students");

  const studentData = {
    name,
    classId,
    createdAt: serverTimestamp()
  };

  if (email) {
    studentData.email = email;
  }

  const docRef = await addDoc(studentsRef, studentData);

  return docRef.id;

}


export async function updateStudent(studentId, updates) {

  const studentRef = doc(db, "students", studentId);

  await updateDoc(studentRef, updates);

}


export async function deleteStudent(studentId) {

  const studentRef = doc(db, "students", studentId);

  await deleteDoc(studentRef);

}


/* ===========================
   ATTENDANCE SESSIONS
=========================== */

export async function createAttendanceSession(classId, date, createdBy) {

  const sessionsRef = collection(db, "attendanceSessions");

  const sessionData = {
    classId,
    date: Timestamp.fromDate(new Date(date)),
    createdBy,
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(sessionsRef, sessionData);

  return docRef.id;

}


export async function getSessionsByClass(classId) {

  const sessionsRef = collection(db, "attendanceSessions");

  const q = query(
    sessionsRef,
    where("classId", "==", classId),
    orderBy("date", "desc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

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

  const sessionRef = doc(db, "attendanceSessions", sessionId);

  await deleteDoc(sessionRef);

}


/* ===========================
   ATTENDANCE RECORDS
=========================== */

export async function saveAttendanceRecord(sessionId, studentId, status) {

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

  const classesRef = collection(db, "classes");

  const snapshot = await getDocs(classesRef);

  if (!snapshot.empty) return;

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
    "Shoe Making"
  ];

  for (const className of defaultClasses) {

    const newDoc = doc(classesRef);

    await setDoc(newDoc, {
      name: className,
      instructorId: "",
      isLocked: false,
      createdAt: serverTimestamp()
    });

  }

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

  const sessionId = await createAttendanceSession(classId, date, createdBy);

  if (Array.isArray(payload.records)) {
    for (const r of payload.records) {
      const studentId = r.studentId || r.id;
      const status = r.status || 'absent';
      if (studentId) {
        await saveAttendanceRecord(sessionId, studentId, status);
      }
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

export async function createClass(name) {

  const classesRef = collection(db, "classes");

  const docRef = await addDoc(classesRef, {
    name,
    instructorId: "",
    isLocked: false,
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
    filteredSessions = sessions.filter(s => s.date.toDate() >= oneWeekAgo);
  } else if (period === 'monthly') {
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    filteredSessions = sessions.filter(s => s.date.toDate() >= oneMonthAgo);
  } else if (period === 'annually') {
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    filteredSessions = sessions.filter(s => s.date.toDate() >= oneYearAgo);
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

  const totalPresent = records.filter(r => r.status === 'present').length;
  const totalAbsent = records.filter(r => r.status === 'absent').length;
  const totalRecords = records.length;
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

// Get next scheduled class dates based on gathering place schedule
export function getNextClassDates(daysAhead = 30) {
  const schedule = {
    'Monday': { type: 'Family Home Evening', classes: [] },
    'Wednesday': { type: 'Skill Acquisition', classes: ['ICT', 'Barbing', 'Catering', 'Fashion/Tailoring', 'Makeup/Facial Stylists', 'Hair Making/Dressing', 'Bag Making', 'Shoe Making'] },
    'Thursday': { type: 'Self-Reliance & Spiritual', classes: ['Self-Reliance', 'BYU Pathway', 'Institute of Religion', 'Temple & Family History', 'Mission Preparation'] },
    'Friday': { type: 'Skill Acquisition', classes: ['ICT', 'Barbing', 'Catering', 'Fashion/Tailoring', 'Makeup/Facial Stylists', 'Hair Making/Dressing', 'Bag Making', 'Shoe Making'] }
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

  return nextDates.slice(0, 14); // Return next 14 scheduled dates
}
