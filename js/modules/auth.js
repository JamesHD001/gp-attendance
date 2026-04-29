// Authentication Module
// Handles login, logout, session timeout, and authentication state

import { auth, db, firebaseSignOut, authPersistenceReady } from '../firebase-config.js';

import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import { getUserRole } from './firestore.js';
import { showNotification } from './ui-utils.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARNING_MS = 60 * 1000;
const SESSION_SYNC_THROTTLE_MS = 60 * 1000;
const SESSION_ACTIVITY_EVENTS = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];

export class AuthService {

  static isLocalEnvironment() {
    return typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  static async waitForAuthReady() {
    await authPersistenceReady;
  }

  static getSessionRef(userId) {
    return doc(db, 'userSessions', userId);
  }

  static buildSessionPayload(userId) {
    const now = Date.now();
    const lastActivityAt = Timestamp.fromMillis(now);

    return {
      uid: userId,
      status: 'active',
      lastActivityAt,
      expiresAt: Timestamp.fromMillis(now + SESSION_TIMEOUT_MS),
      updatedAt: lastActivityAt
    };
  }

  static async touchSession(userId, options = {}) {
    const { force = false } = options;
    const now = Date.now();

    if (!force && now - AuthService.lastSessionSyncAt < SESSION_SYNC_THROTTLE_MS) {
      return;
    }

    AuthService.lastSessionSyncAt = now;
    await setDoc(AuthService.getSessionRef(userId), AuthService.buildSessionPayload(userId), { merge: true });
  }

  static async startSession(user) {
    if (!user || AuthService.isLocalEnvironment()) return;
    await AuthService.touchSession(user.uid, { force: true });
  }

  static async ensureSessionActive(user) {
    if (!user || AuthService.isLocalEnvironment()) return true;

    const sessionSnapshot = await getDoc(AuthService.getSessionRef(user.uid));

    if (!sessionSnapshot.exists()) {
      if (AuthService.isHydratingSession && auth.currentUser?.uid === user.uid) {
        await AuthService.startSession(user);
        return true;
      }
      return false;
    }

    const sessionData = sessionSnapshot.data() || {};
    const expiresAtMs = sessionData.expiresAt?.toMillis?.() || 0;

    if (sessionData.status !== 'active' || !expiresAtMs || expiresAtMs <= Date.now()) {
      await deleteDoc(AuthService.getSessionRef(user.uid)).catch(() => {});
      return false;
    }

    return true;
  }

  static resetSessionTimers(expiresAtMs) {
    if (AuthService.sessionWarningTimer) {
      clearTimeout(AuthService.sessionWarningTimer);
      AuthService.sessionWarningTimer = null;
    }

    if (AuthService.sessionExpiryTimer) {
      clearTimeout(AuthService.sessionExpiryTimer);
      AuthService.sessionExpiryTimer = null;
    }

    const msUntilExpiry = expiresAtMs - Date.now();

    if (msUntilExpiry <= 0) {
      void AuthService.handleSessionExpiration();
      return;
    }

    if (msUntilExpiry > SESSION_WARNING_MS) {
      AuthService.sessionWarningTimer = window.setTimeout(() => {
        showNotification('Your session will expire in 1 minute due to inactivity.', 'warning');
      }, msUntilExpiry - SESSION_WARNING_MS);
    }

    AuthService.sessionExpiryTimer = window.setTimeout(() => {
      void AuthService.handleSessionExpiration();
    }, msUntilExpiry);
  }

  static attachActivityListeners(userId) {
    AuthService.activityHandler = () => {
      AuthService.resetSessionTimers(Date.now() + SESSION_TIMEOUT_MS);
      void AuthService.touchSession(userId).catch((error) => {
        console.error('Failed to sync session activity:', error);
      });
    };

    AuthService.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && AuthService.activityHandler) {
        AuthService.activityHandler();
      }
    };

    for (const eventName of SESSION_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, AuthService.activityHandler, { passive: true });
    }

    document.addEventListener('visibilitychange', AuthService.visibilityHandler);
  }

  static stopSessionMonitoring() {
    if (AuthService.sessionUnsubscribe) {
      AuthService.sessionUnsubscribe();
      AuthService.sessionUnsubscribe = null;
    }

    if (AuthService.sessionWarningTimer) {
      clearTimeout(AuthService.sessionWarningTimer);
      AuthService.sessionWarningTimer = null;
    }

    if (AuthService.sessionExpiryTimer) {
      clearTimeout(AuthService.sessionExpiryTimer);
      AuthService.sessionExpiryTimer = null;
    }

    if (AuthService.activityHandler) {
      for (const eventName of SESSION_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, AuthService.activityHandler);
      }
      AuthService.activityHandler = null;
    }

    if (AuthService.visibilityHandler) {
      document.removeEventListener('visibilitychange', AuthService.visibilityHandler);
      AuthService.visibilityHandler = null;
    }

    AuthService.activeSessionUid = null;
    AuthService.lastSessionSyncAt = 0;
  }

  static async beginSessionMonitoring(user) {
    if (!user || AuthService.isLocalEnvironment()) return;

    if (AuthService.activeSessionUid === user.uid && AuthService.sessionUnsubscribe) {
      return;
    }

    AuthService.stopSessionMonitoring();
    AuthService.activeSessionUid = user.uid;

    await AuthService.touchSession(user.uid, { force: true });

    AuthService.sessionUnsubscribe = onSnapshot(
      AuthService.getSessionRef(user.uid),
      (sessionSnapshot) => {
        if (!sessionSnapshot.exists()) {
          void AuthService.handleSessionExpiration();
          return;
        }

        const sessionData = sessionSnapshot.data() || {};
        const expiresAtMs = sessionData.expiresAt?.toMillis?.() || 0;

        if (sessionData.status !== 'active' || !expiresAtMs || expiresAtMs <= Date.now()) {
          void AuthService.handleSessionExpiration();
          return;
        }

        AuthService.resetSessionTimers(expiresAtMs);
      },
      (error) => {
        console.error('Session listener error:', error);
      }
    );

    AuthService.attachActivityListeners(user.uid);
  }

  static async handleSessionExpiration() {
    if (AuthService.isLoggingOut) return;
    await AuthService.logout({ reason: 'session-expired' });
  }

  static async login(email, password) {
    try {
      await AuthService.waitForAuthReady();
      AuthService.isHydratingSession = true;
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await AuthService.startSession(userCredential.user);
      return userCredential.user;
    } catch (error) {
      console.error("Login Error:", error);
      throw new Error("Invalid email or password.");
    } finally {
      AuthService.isHydratingSession = false;
    }
  }

  // Ensure the logged-in user has the correct role for the page
  static async requireRole(expectedRole) {
    await AuthService.waitForAuthReady();

    if (AuthService.isLocalEnvironment()) return true;

    const user = auth.currentUser;

    if (!user) {
      window.location.href = AuthService.getIndexPath();
      return false;
    }
  
    try {
      const sessionIsActive = await AuthService.ensureSessionActive(user);

      if (!sessionIsActive) {
        await AuthService.logout({ reason: 'session-expired', skipSessionCleanup: true });
        return false;
      }

      const role = await getUserRole(user.uid);
  
      if (role !== expectedRole) {
        AuthService.stopSessionMonitoring();
        await AuthService.redirectBasedOnRole(user);
        return false;
      }

      await AuthService.beginSessionMonitoring(user);
      return true;
  
    } catch (error) {
  
      console.error("Role error:", error);
      window.location.href = AuthService.getIndexPath();
      return false;
  
    }
  
  }

  static async logout(options = {}) {
    const { reason = null, skipSessionCleanup = false } = options;

    try {
      const isLocal = AuthService.isLocalEnvironment();
      const sessionUserId = auth.currentUser?.uid || AuthService.activeSessionUid;

      AuthService.isLoggingOut = true;
      AuthService.stopSessionMonitoring();

      if (isLocal) {
        window.location.href = AuthService.buildIndexUrl(reason);
        return;
      }

      if (sessionUserId && !skipSessionCleanup) {
        await deleteDoc(AuthService.getSessionRef(sessionUserId)).catch((error) => {
          console.warn('Session cleanup failed:', error);
        });
      }

      if (auth.currentUser) {
        await firebaseSignOut(auth);
      }

      window.location.href = AuthService.buildIndexUrl(reason);
    } catch (error) {
      console.error("Logout Error:", error);
      throw new Error("Logout failed.");
    }
  }

  // Determine the correct path to the login page from the current page
  static getIndexPath() {
    if (typeof window === 'undefined') return 'index.html';
    return window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
  }

  static buildIndexUrl(reason = null) {
    const indexPath = AuthService.getIndexPath();

    if (!reason) {
      return indexPath;
    }

    const params = new URLSearchParams({ reason });
    return `${indexPath}?${params.toString()}`;
  }

  static showReasonFromUrl() {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');

    if (reason === 'session-expired') {
      showNotification('Your session expired due to inactivity. Please sign in again.', 'warning');
      params.delete('reason');
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
      history.replaceState(null, '', nextUrl);
    }
  }

  // Get current logged-in user
  static getCurrentUser() {
    if (AuthService.isLocalEnvironment()) return { uid: 'devUser' };
    return auth.currentUser;
  }

  // Listen for authentication changes
  static onAuthStateChanged(callback) {
    let unsubscribe = () => {};

    AuthService.waitForAuthReady()
      .then(() => {
        unsubscribe = onAuthStateChanged(auth, callback);
      })
      .catch((error) => {
        console.error('Auth state listener setup failed:', error);
      });

    return () => unsubscribe();
  }

  // Redirect user to the correct dashboard
  static async redirectBasedOnRole(user) {

    if (!user) {
      window.location.href = AuthService.getIndexPath();
      return;
    }

    try {

      const role = await getUserRole(user.uid);

      // If user record exists but role is not set yet, avoid kicking the user
      // back to the login screen which creates a redirect loop.
      if (role == null) {
        console.warn('User role not found for', user.uid, '- staying on current page for manual handling.');
        return;
      }

      let redirectPath = AuthService.getIndexPath();

      switch (role) {

        case "admin":
          redirectPath = "pages/admin-dashboard.html";
          break;

        case "instructor":
          redirectPath = "pages/instructor-dashboard.html";
          break;

        case "leader":
          redirectPath = "pages/leader-dashboard.html";
          break;

        default:
          redirectPath = AuthService.getIndexPath();
      }

      const currentPage = window.location.pathname;
      const targetFile = redirectPath.split('/').pop();

      // Prevent redirect loop by comparing filenames
      if (!currentPage.endsWith(targetFile)) {
        window.location.href = redirectPath;
      }

    } catch (error) {

      console.error("Role redirect error:", error);
      // Don't redirect to login on transient role/read errors — this can
      // cause a redirect loop if Firestore read fails or permissions are
      // temporarily unavailable. Leave the user on the current page so
      // they can retry or the client can recover.
      return;

    }
  }
}

AuthService.sessionUnsubscribe = null;
AuthService.sessionWarningTimer = null;
AuthService.sessionExpiryTimer = null;
AuthService.activityHandler = null;
AuthService.visibilityHandler = null;
AuthService.activeSessionUid = null;
AuthService.lastSessionSyncAt = 0;
AuthService.isHydratingSession = false;
AuthService.isLoggingOut = false;
