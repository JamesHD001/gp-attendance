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
const firebaseConfig = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID',
  measurementId: 'FIREBASE_MEASUREMENT_ID'
};

let app;
let auth;
let db;
let authPersistenceReady = Promise.resolve();

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
