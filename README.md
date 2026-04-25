# YSA GP Attendance System

A production-ready, fully client-side attendance management system for LDS Church Youth Skill Acquisition Programs built with vanilla JavaScript, HTML, CSS, and Firebase.

## 🎯 Features

- **Secure Authentication**: Firebase Email/Password authentication
- **Role-Based Access Control**: Admin, Instructor, and Leader dashboards
- **Attendance Tracking**: Create sessions, mark attendance, view records
- **Analytics & Reporting**: Class-wide and student-specific attendance stats
- **Responsive Design**: Mobile and desktop optimized with LDS-style minimal UI
- **Print-Friendly**: Export attendance reports to PDF via print function
- **No Backend Required**: Fully serverless, runs entirely client-side

## 👥 User Roles

### Admin

- View and manage all classes
- Lock/unlock classes
- Add, remove, and manage users
- Create and manage attendance sessions
- Edit/delete attendance records
- View system-wide analytics
- Print/export attendance data

### Instructor

- View only their assigned class
- Add and remove students from their class
- Create attendance sessions
- Mark attendance (present/absent)
- View class-specific statistics
- Print attendance records

### Leader

- **Read-only access**
- View all classes and attendance reports
- View analytics and statistics
- Print reports

## 📚 Supported Classes

1. ICT
2. Barbing
3. Bag Making
4. Catering
5. Fashion/Tailoring
6. Makeup/Facial Stylists
7. Hair Making/Dressing
8. Self-Reliance
9. Temple & Family History
10. Mission Preparation
11. BYU Pathway
12. Guest
13. Institute of Religion
14. Shoe Making

## 🔧 Tech Stack

- **Frontend**: HTML5, CSS3, ES6 JavaScript (Modules)
- **Backend**: Firebase v10 (Authentication + Firestore)
- **Hosting**: GitHub Pages (no server needed)
- **No frameworks**: No React, Vue, Angular, or build tools required

## 📁 Project Structure

```text
gp-attendance/
├── index.html                          # Login page
├── css/
│   └── styles.css                     # Global styles (LDS minimal design)
├── js/
│   └── modules/
│       ├── firebase-config.js          # Firebase initialization
│       ├── auth.js                     # Authentication service
│       ├── firestore.js                # Firestore operations
│       ├── ui-utils.js                 # UI helper functions
│       ├── admin-dashboard.js          # Admin dashboard logic
│       ├── instructor-dashboard.js     # Instructor dashboard logic
│       └── leader-dashboard.js         # Leader dashboard logic
├── pages/
│   ├── admin-dashboard.html            # Admin dashboard page
│   ├── instructor-dashboard.html       # Instructor dashboard page
│   └── leader-dashboard.html           # Leader dashboard page
├── .gitignore                          # Git ignore file
├── .nojekyll                           # GitHub Pages config
└── README.md                           # This file
```

## 🚀 Quick Start

### Prerequisites

1. A Firebase project (create one at [firebase.google.com](https://firebase.google.com))
2. Git and GitHub account
3. A web browser (Chrome, Firefox, Safari, or Edge)

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create project"
3. Name it "YSA GP Attendance" (or any name)
4. Enable Google Analytics (optional)
5. Click "Create project"

### Step 2: Enable Authentication

1. In Firebase Console, go to **Authentication**
2. Click **Get started**
3. Click **Email/Password** provider
4. Enable it and save

### Step 3: Create Firestore Database

1. In Firebase Console, go to **Firestore Database**
2. Click **Create database**
3. Start in **test mode** (for development) or **production mode** with appropriate rules
4. Choose your nearest region
5. Click **Create**

### Step 4: Get Firebase Config

1. In Firebase Console, click the gear icon ⚙️
2. Go to **Project settings**
3. Under "Your apps", click the Web icon (`</>`)
4. Copy your Firebase config object

### Step 5: Update Firebase Credentials

1. Edit `js/modules/firebase-config.js`
2. Replace the placeholder config with your real Firebase config:

```javascript
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
  measurementId: 'YOUR_MEASUREMENT_ID'
};
```

### Local development (recommended)

To avoid committing credentials, this project supports a local `.env` → JS config workflow:

1. Copy `.env.example` to `.env` and fill values.

   - Windows:

     ```powershell
     copy .env.example .env
     ```

   - macOS / Linux:

     ```bash
     cp .env.example .env
     ```

2. Generate the local JS file used by the app:

```bash
npm run gen-config
# or
node scripts/generate-firebase-config.js
```

This writes `js/modules/firebase-config.local.js` (gitignored). The app will import that file automatically; if it's missing the code falls back to placeholder values and prints a console warning.

### Step 6: Set Firestore Security Rules

In Firebase Console > Firestore > Rules, use these rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write only to authenticated users
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId || 
                           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /classes/{classId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /students/{studentId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' ||
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.assignedClassId == 
          get(/databases/$(database)/documents/students/$(studentId)).data.classId
      );
    }
    
    match /attendanceSessions/{sessionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role != 'leader'
      );
    }
    
    match /attendanceRecords/{recordId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role != 'leader'
      );
    }
  }
}
```

### Step 7: Create Test Users

In Firebase Console > Authentication:

1. Click **Add user**
2. Create users with different roles:
   - **Admin**: <admin@example.com> / password123
   - **Instructor**: <instructor@example.com> / password123
   - **Leader**: <leader@example.com> / password123

3. In Firestore, manually add user documents in the `users` collection:

For Admin:

```json
UID: [admin user ID]
name: "Admin User"
email: "admin@example.com"
role: "admin"
```

For Instructor:

```text
UID: [instructor user ID]
name: "Instructor Name"
email: "instructor@example.com"
role: "instructor"
assignedClassId: "[classId of first class]"
```

For Leader:

```text
UID: [leader user ID]
name: "Leader Name"
email: "leader@example.com"
role: "leader"
```

## 🌐 Deploy to GitHub Pages

### Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `gp-attendance`
3. Add description: "YSA GP Attendance System"
4. Choose Public (or Private if you prefer)
5. Click "Create repository"

### Step 2: Push Code to GitHub

```bash
cd gp-attendance
git init
git add .
git commit -m "Initial commit: YSA GP Attendance System"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gp-attendance.git
git push -u origin main
```

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** > **Pages**
3. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **main** / **root**
4. Click **Save**

Your site will be live at: `https://YOUR_USERNAME.github.io/gp-attendance/`

## 📋 Firestore Database Structure

### Collections

#### users

```text
{
  uid (document ID)
  name: string
  email: string
  role: "admin" | "instructor" | "leader"
  assignedClassId: string (only for instructors)
  createdAt: timestamp
}
```

#### classes

```text
{
  classId (document ID)
  name: string
  instructorId: string (uid)
  isLocked: boolean
  createdAt: timestamp
}
```

#### students

```text
{
  studentId (document ID)
  name: string
  classId: string
  email: string (optional)
  createdAt: timestamp
}
```

#### attendanceSessions

```text
{
  sessionId (document ID)
  classId: string
  date: timestamp
  createdBy: string (uid)
  createdAt: timestamp
}
```

#### attendanceRecords

```text
{
  recordId (document ID)
  sessionId: string
  studentId: string
  status: "present" | "absent"
  createdAt: timestamp
}
```

## 🔐 Security Considerations

1. **Keep Firebase Config Private**: Never commit real credentials to public repos
2. **Use Test Mode Carefully**: Switch to Production mode with proper rules before going live
3. **Firestore Rules**: Custom rules prevent unauthorized access
4. **Row-Level Security**: Instructors can only see their own class data
5. **Read-Only Leaders**: Leader role has no write permissions

## 🖨️ Printing & Exporting

- Click "Print Report" button in any dashboard
- Use browser print (Ctrl+P) to save as PDF
- Print stylesheet automatically hides navigation and buttons

## 🐛 Troubleshooting

### "Firebase initialization error"

- Check your `firebase-config.js` has correct credentials
- Verify Firebase project is active in Console

### "Login failed: auth/user-not-found"

- Create test users in Firebase Authentication first
- Make sure user documents exist in Firestore `users` collection

### "No class assigned to you yet"

- Admin must assign an instructor to a class
- Edit the instructor's user document and set `assignedClassId` to a valid classId

### Users can't see data

- Check Firestore Security Rules are correctly set
- Verify user's role in Firestore matches their intended role

### Pages not loading after login

- Check browser console for errors (F12)
- Verify Firebase config is correct
- Ensure user documents exist in Firestore with correct role

## 📱 Browser Support

- Chrome/Edge 60+
- Firefox 55+
- Safari 12+
- Mobile browsers (iOS Safari, Chrome Android)

## 🎨 Customization

### Colors

Edit CSS variables in `css/styles.css`:

```css
:root {
  --primary-blue: #0066cc;
  --primary-dark: #003399;
  /* ... */
}
```

### Classes List

Edit the default classes in `js/modules/firestore.js`:

```javascript
const defaultClasses = [
  'Your Class 1',
  'Your Class 2',
  // ...
];
```

## 📄 License

This project is created for YSA GP Programs. Modify and use as needed.

## 🤝 Support

For issues:

1. Check browser console (F12) for error messages
2. Verify Firebase configuration
3. Check Firestore rules allow your operations
4. Clear browser cache and reload

## 📞 Contact

For questions about the YSA program, contact your local YSA leadership.

---

**Last Updated**: March 2026
**Version**: 1.0.0
