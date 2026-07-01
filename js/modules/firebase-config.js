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
let firebaseConfig = null;
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
  console.warn('Local Firebase config is unavailable. Make sure js/modules/firebase-config.local.js exists.', error);
}

if (!firebaseConfig || firebaseConfig.apiKey?.includes('FIREBASE_')) {
  throw new Error('Firebase configuration is missing or still uses placeholder values. Generate js/modules/firebase-config.local.js with your real Firebase project settings.');
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
