from pathlib import Path
import re

root = Path('.')

# Route moderator accounts to the dedicated moderator console.
auth = root / 'js/modules/auth.js'
s = auth.read_text()
if 'case "moderator":' not in s:
    pattern = r'(case\s+["\']admin["\']:\s*\n\s*redirectPath\s*=\s*AuthService\.getDashboardPath\(["\']admin-dashboard\.html["\']\);\s*\n\s*break;)'
    match = re.search(pattern, s)
    if not match:
        raise SystemExit('Could not find the admin redirect case in auth.js')
    replacement = "case \"admin\":\n          redirectPath = AuthService.getDashboardPath('admin-dashboard.html');\n          break;\n\n        case \"moderator\":\n          redirectPath = AuthService.getDashboardPath('moderator-dashboard.html');\n          break;"
    s = s[:match.start()] + replacement + s[match.end():]
    auth.write_text(s)

rules_path = root / 'firestore.rules'
rules = rules_path.read_text()

if 'function isModerator()' not in rules:
    needle = "    function isAdmin() {\n      return isSignedIn() && getUserRole(request.auth.uid) == 'admin';\n    }\n"
    if needle not in rules:
        raise SystemExit('isAdmin helper not found in firestore.rules')
    rules = rules.replace(needle, needle + "\n    function isModerator() {\n      return isSignedIn() && getUserRole(request.auth.uid) == 'moderator';\n    }\n\n    function canModerateAttendance() {\n      return isAdmin() || isModerator();\n    }\n", 1)

# Moderators need read access to instructor/user records, but never write access.
rules = rules.replace('      // Admins can read all users\n      allow read: if isAdmin();', '      // Admins and moderators can read all users\n      allow read: if isAdmin() || isModerator();', 1)

if 'function getStudentData(studentId)' not in rules:
    needle = '    function studentBelongsToClass(studentId, classId) {'
    if needle in rules:
        rules = rules.replace(needle, "    function getStudentData(studentId) {\n      return exists(/databases/$(database)/documents/students/$(studentId))\n        ? get(/databases/$(database)/documents/students/$(studentId)).data\n        : null;\n    }\n\n" + needle, 1)
rules = re.sub(r'(function studentBelongsToClass\(studentId, classId\) \{\s*let studentData = )getUserData\(studentId\);', r'\1getStudentData(studentId);', rules, count=1)

# Keep only one sessionDoc helper if an earlier version already contained it.
session_doc = """    function sessionDoc(sessionId) {
      return exists(/databases/$(database)/documents/attendanceSessions/$(sessionId))
        ? get(/databases/$(database)/documents/attendanceSessions/$(sessionId)).data
        : null;
    }
"""
while rules.count(session_doc) > 1:
    first = rules.find(session_doc)
    second = rules.find(session_doc, first + len(session_doc))
    rules = rules[:second] + rules[second + len(session_doc):]

if 'function moderatorOwnsSession(sessionId)' not in rules:
    marker = '    function canModerateAttendance() {\n      return isAdmin() || isModerator();\n    }\n'
    if marker not in rules:
        raise SystemExit('Moderator helper marker not found')
    rules = rules.replace(marker, marker + session_doc + "\n    function moderatorOwnsSession(sessionId) {\n      let session = sessionDoc(sessionId);\n      return isModerator() && session != null && session.createdBy == request.auth.uid;\n    }\n", 1)

if 'allow create: if isModerator()' not in rules:
    marker = '      // Instructors may create sessions for their own class'
    if marker not in rules:
        raise SystemExit('Attendance session insertion marker not found')
    block = """      // Moderators can create/update attendance sessions for any existing class
      // or a general Gathering Place summary, but cannot delete sessions.
      allow create: if isModerator() &&
        request.resource.data.createdBy == request.auth.uid &&
        request.resource.data.date is timestamp &&
        ((request.resource.data.classId == 'GENERAL' && request.resource.data.isGeneral == true) ||
         exists(/databases/$(database)/documents/classes/$(request.resource.data.classId)));

      allow update: if isModerator() &&
        resource.data.createdBy == request.auth.uid &&
        request.resource.data.createdBy == request.auth.uid &&
        request.resource.data.date is timestamp &&
        request.resource.data.classId == resource.data.classId;

"""
    rules = rules.replace(marker, block + marker, 1)

if 'moderatorOwnsSession(request.resource.data.sessionId)' not in rules:
    marker = '      // Instructors may create attendance records for sessions they own'
    if marker not in rules:
        raise SystemExit('Attendance record insertion marker not found')
    block = """      // Moderators can create/update records only inside sessions they created
      // and only for students belonging to that session's class.
      allow create, update: if isModerator() &&
        moderatorOwnsSession(request.resource.data.sessionId) &&
        request.resource.data.status in ['present', 'absent'] &&
        exists(/databases/$(database)/documents/students/$(request.resource.data.studentId)) &&
        ((get(/databases/$(database)/documents/students/$(request.resource.data.studentId)).data.classId == sessionDoc(request.resource.data.sessionId).classId) ||
         (get(/databases/$(database)/documents/students/$(request.resource.data.studentId)).data.sharedClassIds != null &&
          sessionDoc(request.resource.data.sessionId).classId in get(/databases/$(database)/documents/students/$(request.resource.data.studentId)).data.sharedClassIds));

"""
    rules = rules.replace(marker, block + marker, 1)

if 'match /instructorAttendance/{recordId}' not in rules:
    marker = '    // ====================\n    // PERFORMANCE RATINGS COLLECTION'
    if marker not in rules:
        raise SystemExit('Performance ratings marker not found')
    block = """    // ====================
    // INSTRUCTOR ATTENDANCE COLLECTION
    // ====================
    match /instructorAttendance/{recordId} {
      allow read: if isSignedIn();

      // Moderators and admins may mark/correct instructor attendance.
      allow create, update: if canModerateAttendance() &&
        request.resource.data.instructorId is string &&
        request.resource.data.instructorId != '' &&
        getUserRole(request.resource.data.instructorId) == 'instructor' &&
        request.resource.data.date is string &&
        request.resource.data.status in ['present', 'absent'] &&
        request.resource.data.markedBy == request.auth.uid;

      // Only admins can delete instructor attendance records.
      allow delete: if isAdmin();
    }

"""
    rules = rules.replace(marker, block + marker, 1)

rules_path.write_text(rules)
print('Moderator authentication and Firestore security rules applied.')
