# Firestore Schema for gp-attendance

This document describes the recommended Firestore collections, documents, and fields for the YSA GP Attendance System.

## Collections & Documents

- `users` (document id = Firebase Auth UID)
  - Fields:
    - `name`: string
    - `email`: string
    - `role`: string — one of `admin`, `instructor`, `leader`
    - `assignedClassId`: string (nullable) — used for instructors
    - `createdAt`: timestamp

- `classes` (document id = auto-generated)
  - Fields:
    - `name`: string
    - `instructorId`: string (UID or empty string)
    - `isLocked`: boolean
    - `createdAt`: timestamp

- `students` (document id = auto-generated)
  - Fields:
    - `name`: string
    - `email`: string (optional)
    - `classId`: string (reference to `classes` doc id)
    - `createdAt`: timestamp

- `attendanceSessions` (document id = auto-generated)
  - Fields:
    - `classId`: string
    - `date`: timestamp
    - `createdBy`: string (UID of creator)
    - `createdAt`: timestamp

- `attendanceRecords` (document id = auto-generated)
  - Fields:
    - `sessionId`: string (refers to `attendanceSessions` doc id)
    - `studentId`: string (refers to `students` doc id)
    - `status`: string — `present` or `absent`
    - `createdAt`: timestamp

## Index Recommendations

- Index `students` by `classId` for efficient class lookups.  
- Index `attendanceRecords` by `sessionId` for session lookups.  
- Optional: composite index for `attendanceSessions` on (`classId`, `date`) to query sessions in date order.

## Notes on field names used by the code

- The code expects instructor assignment to use `assignedClassId` on user documents. Some legacy references use `assignedClass`; prefer `assignedClassId` consistently.

## Security / Rules guidance

- Enforce server-side security with Firestore Security Rules.  
- Provide read access to authenticated users where needed and restrict writes to admins or instructors scoped to their class.  

## Recommendations / Migration Notes

- Use Firestore server timestamps for all `createdAt` fields (i.e. `serverTimestamp()`) to ensure consistent types and ordering across clients and server scripts.
- `attendanceSessions` documents do not embed attendance records in this schema; `attendanceRecords` is a separate collection keyed by `sessionId` so code should query `attendanceRecords` for session details.
- Standardize on `assignedClassId` for instructor assignment. If you have existing user documents with `assignedClass`, run a one-time migration script to copy `assignedClass` -> `assignedClassId` and confirm tests before removing the legacy field.
- Update any docs, UI labels, and security rules to reference `assignedClassId` to avoid runtime mismatches.
