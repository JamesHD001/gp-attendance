// Firebase Configuration Module
// This file contains the Firebase SDK initialization

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';

import {
  getFirestore
} from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js';

// Firebase configuration
const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyDshXOLzDSZnRK6B4vPVQgIT1ILhQS50GM',
  authDomain: 'ysa-gp-attendance.firebaseapp.com',
  projectId: 'ysa-gp-attendance',
  storageBucket: 'ysa-gp-attendance.firebasestorage.app',
  messagingSenderId: '125191084521',
  appId: '1:125191084521:web:dd61d93fa5e0c477b7d378',
  measurementId: 'G-62NCJBYJ36'
};

let firebaseConfig = fallbackFirebaseConfig;
let app;
let auth;
let db;
let authPersistenceReady = Promise.resolve();

try {
  const localConfigModule = await import('./firebase-config.local.js');
  if (localConfigModule?.firebaseConfig) {
    firebaseConfig = localConfigModule.firebaseConfig;
  }
} catch (error) {
  console.warn('Using fallback Firebase config placeholders because local Firebase config is unavailable.', error);
}

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  authPersistenceReady = setPersistence(auth, browserSessionPersistence)
    .catch(async (error) => {
      console.warn('Browser session persistence is unavailable; falling back to in-memory auth state.', error);
      await setPersistence(auth, inMemoryPersistence);
    });
  db = getFirestore(app);
} catch (error) {
  console.error('Firebase initialization error:', error);
  authPersistenceReady = Promise.reject(error);
}

export { app, auth, db, firebaseSignOut, firebaseConfig, authPersistenceReady };
