// Firebase Configuration Module
// This file contains the Firebase SDK initialization

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { 
  getAuth, 
  signOut as firebaseSignOut 
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';

import { 
  getFirestore 
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js';

// Firebase configuration
// Try to load a local, gitignored config file first. This file is optional
// and should be created locally as `js/modules/firebase-config.local.js`.
// If not found, fall back to placeholder values so the app doesn't crash
// but also warns the developer to provide real credentials.

let firebaseConfig;
try {
  const local = await import('./firebase-config.local.js');
  firebaseConfig = local.firebaseConfig;
} catch (err) {
  console.warn('Local firebase-config.local.js not found — using placeholder config.\nCreate js/modules/firebase-config.local.js or run scripts/generate-firebase-config.js with a .env file.');
  firebaseConfig = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    measurementId: 'G-MEASUREMENT_ID'
  };
}

let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error('Firebase initialization error:', error);
}

export { app, auth, db, firebaseSignOut };