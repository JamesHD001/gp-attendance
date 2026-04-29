// Firebase Configuration Module
// This file contains the Firebase SDK initialization

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { 
  getAuth, 
  setPersistence,
  browserSessionPersistence,
  signOut as firebaseSignOut 
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';

import { 
  getFirestore 
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyDshXOLzDSZnRK6B4vPVQgIT1ILhQS50GM',
  authDomain: 'ysa-gp-attendance.firebaseapp.com',
  projectId: 'ysa-gp-attendance',
  storageBucket: 'ysa-gp-attendance.firebasestorage.app',
  messagingSenderId: '125191084521',
  appId: '1:125191084521:web:dd61d93fa5e0c477b7d378',
  measurementId: 'G-62NCJBYJ36'
};

let app;
let auth;
let db;
let authPersistenceReady = Promise.resolve();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  authPersistenceReady = setPersistence(auth, browserSessionPersistence);
  db = getFirestore(app);
} catch (error) {
  console.error('Firebase initialization error:', error);
  authPersistenceReady = Promise.reject(error);
}

export { app, auth, db, firebaseSignOut, firebaseConfig, authPersistenceReady };
