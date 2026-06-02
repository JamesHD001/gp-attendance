// Authentication Module
// Handles login, logout, session timeout, and authentication state

import { auth, db, firebaseSignOut, authPersistenceReady } from '../firebase-config.js';

import {
  signInWithEmailAndPassword,
  signInWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  linkWithCredential,
  updateEmail,
  updatePassword,
  sendPasswordResetEmail,
  EmailAuthProvider,
  GoogleAuthProvider,
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
const PENDING_SESSION_STORAGE_KEY = 'gpPendingSessionUid';

export class AuthService {

  static isLocalEnvironment() {
    return typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  static async waitForAuthReady() {
    await authPersistenceReady;
  }

  static canUseSessionStorage() {
    try {
      return typeof window !== 'undefined' && Boolean(window.sessionStorage);
    } catch (error) {
      console.warn('Session storage is unavailable:', error);
      return false;
    }
  }

  static markPendingSessionHydration(userId) {
    if (!userId || !AuthService.canUseSessionStorage()) return;
    window.sessionStorage.setItem(PENDING_SESSION_STORAGE_KEY, userId);
  }

  static getPendingSessionHydrationUid() {
    if (!AuthService.canUseSessionStorage()) return null;
    return window.sessionStorage.getItem(PENDING_SESSION_STORAGE_KEY);
  }

  static clearPendingSessionHydration(userId = null) {
    if (!AuthService.canUseSessionStorage()) return;

    if (userId && window.sessionStorage.getItem(PENDING_SESSION_STORAGE_KEY) !== userId) {
      return;
    }

    window.sessionStorage.removeItem(PENDING_SESSION_STORAGE_KEY);
  }

  static shouldHydrateMissingSession(user) {
    if (!user?.uid) return false;

    // If the current authenticated user matches, hydrate.
    if (auth.currentUser?.uid === user.uid) return true;

    // Fall back to the pending-session marker in sessionStorage (handles reloads during login).
    return AuthService.getPendingSessionHydrationUid() === user.uid;
  }

  static getLoginErrorMessage(error) {
    switch (error?.code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-email':
      case 'auth/invalid-login-credentials':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Invalid email or password.';
      case 'auth/too-many-requests':
        return 'Too many sign-in attempts. Please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Unable to reach Firebase right now. Check your internet connection and try again.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in was cancelled.';
      case 'auth/popup-blocked':
        return 'Your browser blocked the Google sign-in pop-up. Allow pop-ups and try again.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with this email address. Sign in with your password to link Google.';
      default:
        return 'Login failed. Please try again.';
    }
  }

  static hasPasswordProvider(user = auth.currentUser) {
    return Boolean(user?.providerData?.some((providerData) => providerData?.providerId === 'password'));
  }

  static hasGoogleProvider(user = auth.currentUser) {
    return Boolean(user?.providerData?.some((providerData) => providerData?.providerId === GoogleAuthProvider.PROVIDER_ID));
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
    if (!user || AuthService.isLocalEnvironment()) return true;

    try {
      await AuthService.touchSession(user.uid, { force: true });
      return true;
    } catch (error) {
      console.error('Failed to start session:', error);
      return false;
    }
  }

  static async ensureSessionActive(user) {
    if (!user || AuthService.isLocalEnvironment()) return true;
    try {
      const sessionSnapshot = await getDoc(AuthService.getSessionRef(user.uid));

      if (!sessionSnapshot.exists()) {
        if (AuthService.shouldHydrateMissingSession(user)) {
          const sessionStarted = await AuthService.startSession(user);
          if (sessionStarted) {
            AuthService.clearPendingSessionHydration(user.uid);
          }
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

      AuthService.clearPendingSessionHydration(user.uid);
      return true;
    } catch (error) {
      // Handle permission errors gracefully — sometimes rules or transient
      // emulator states can cause a permission-denied when reading the
      // session document. Attempt to start the session (write) as a
      // recovery path; if that fails, consider the session inactive.
      console.warn('Failed to read session document:', error);
      if (error?.code === 'permission-denied' || (error?.message || '').includes('Missing or insufficient permissions')) {
        try {
          const sessionStarted = await AuthService.startSession(user);
          if (sessionStarted) {
            AuthService.clearPendingSessionHydration(user.uid);
            return true;
          }
        } catch (inner) {
          console.error('Recovery startSession failed:', inner);
        }
      }
      return false;
    }
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

    const sessionStarted = await AuthService.startSession(user);

    AuthService.resetSessionTimers(Date.now() + SESSION_TIMEOUT_MS);

    if (sessionStarted) {
      AuthService.clearPendingSessionHydration(user.uid);
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
    } else {
      console.warn('Session sync is unavailable; using local inactivity timers until sync recovers.');
    }

    AuthService.attachActivityListeners(user.uid);
  }

  static async handleSessionExpiration() {
    if (AuthService.isLoggingOut) return;
    await AuthService.logout({ reason: 'session-expired' });
  }

  static async login(email, password) {
    await AuthService.waitForAuthReady();
    AuthService.clearPendingSessionHydration();
    AuthService.isHydratingSession = true;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      AuthService.markPendingSessionHydration(userCredential.user.uid);
      await AuthService.startSession(userCredential.user);
      return userCredential.user;
    } catch (error) {
      console.error("Login Error:", error);
      AuthService.clearPendingSessionHydration();
      throw new Error(AuthService.getLoginErrorMessage(error));
    } finally {
      AuthService.isHydratingSession = false;
    }
  }

  static async loginWithGoogle() {
    await AuthService.waitForAuthReady();
    AuthService.clearPendingSessionHydration();
    AuthService.isHydratingSession = true;

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      const userCredential = await signInWithPopup(auth, provider);
      AuthService.markPendingSessionHydration(userCredential.user.uid);
      await AuthService.startSession(userCredential.user);
      return userCredential.user;
    } catch (error) {
      console.error('Google Login Error:', error);

      const pendingCredential =
        GoogleAuthProvider.credentialFromError(error) ||
        error?.credential ||
        null;

      if (error?.code === 'auth/account-exists-with-different-credential' && pendingCredential) {
        const linkError = new Error(
          'An account already exists for this email. Sign in with your password to link Google to the same account.'
        );
        linkError.code = error.code;
        linkError.email = error?.customData?.email || error?.email || '';
        linkError.pendingCredential = pendingCredential;
        throw linkError;
      }

      AuthService.clearPendingSessionHydration();
      throw new Error(AuthService.getLoginErrorMessage(error));
    } finally {
      AuthService.isHydratingSession = false;
    }
  }

  static async linkGoogleCredentialWithPassword(email, password, pendingCredential) {
    await AuthService.waitForAuthReady();

    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    if (!pendingCredential) {
      throw new Error('Missing Google sign-in credential.');
    }

    AuthService.clearPendingSessionHydration();
    AuthService.isHydratingSession = true;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const linkedCredential = await linkWithCredential(userCredential.user, pendingCredential);
      AuthService.markPendingSessionHydration(linkedCredential.user.uid);
      await AuthService.startSession(linkedCredential.user);
      return linkedCredential.user;
    } catch (error) {
      console.error('Google account linking failed:', error);

      if (error?.code === 'auth/provider-already-linked') {
        const currentUser = auth.currentUser;
        if (currentUser) {
          AuthService.markPendingSessionHydration(currentUser.uid);
          await AuthService.startSession(currentUser);
          return currentUser;
        }
      }

      throw new Error(AuthService.getLoginErrorMessage(error));
    } finally {
      AuthService.isHydratingSession = false;
    }
  }

  static async sendPasswordReset(email) {
    await AuthService.waitForAuthReady();

    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
      throw new Error('Please enter your email address.');
    }

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      return true;
    } catch (error) {
      console.error('Password reset failed:', error);

      if (error?.code === 'auth/user-not-found') {
        return true;
      }

      if (error?.code === 'auth/invalid-email') {
        throw new Error('Please enter a valid email address.');
      }

      throw new Error(error?.message || 'Unable to send password reset email.');
    }
  }

  static async changePassword(currentPassword, newPassword) {
    await AuthService.waitForAuthReady();

    const user = auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to change your password.');
    }

    if (!AuthService.hasPasswordProvider(user)) {
      throw new Error('This account uses Google sign-in and does not have a password to change.');
    }

    const email = String(user.email || '').trim();
    if (!email) {
      throw new Error('A valid email address is required to change the password.');
    }

    const currentPasswordValue = String(currentPassword || '');
    const newPasswordValue = String(newPassword || '');

    if (!currentPasswordValue || !newPasswordValue) {
      throw new Error('Current password and new password are required.');
    }

    try {
      const credential = EmailAuthProvider.credential(email, currentPasswordValue);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPasswordValue);
      return true;
    } catch (error) {
      console.error('Password update failed:', error);

      switch (error?.code) {
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
          throw new Error('Current password is incorrect.');
        case 'auth/weak-password':
          throw new Error('Your new password is too weak. Use at least 6 characters.');
        case 'auth/requires-recent-login':
          throw new Error('Please sign out and sign back in, then try again.');
        case 'auth/user-mismatch':
          throw new Error('Your current password does not match this account.');
        default:
          throw new Error(error?.message || 'Unable to change password.');
      }
    }
  }

  static async changeEmail(nextEmail, options = {}) {
    await AuthService.waitForAuthReady();

    const user = auth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to change your email address.');
    }

    const normalizedEmail = String(nextEmail || '').trim();
    if (!normalizedEmail) {
      throw new Error('Email address is required.');
    }

    if (normalizedEmail === String(user.email || '').trim()) {
      return true;
    }

    try {
      if (AuthService.hasPasswordProvider(user)) {
        const currentPassword = String(options.currentPassword || '');
        if (!currentPassword) {
          throw new Error('Current password is required to update your email.');
        }

        const credential = EmailAuthProvider.credential(String(user.email || ''), currentPassword);
        await reauthenticateWithCredential(user, credential);
      } else if (AuthService.hasGoogleProvider(user)) {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await reauthenticateWithPopup(user, provider);
      } else {
        throw new Error('This account cannot change its email address from the settings page.');
      }

      await updateEmail(user, normalizedEmail);
      return true;
    } catch (error) {
      console.error('Email update failed:', error);

      switch (error?.code) {
        case 'auth/invalid-email':
          throw new Error('Please enter a valid email address.');
        case 'auth/email-already-in-use':
          throw new Error('That email address is already in use.');
        case 'auth/popup-blocked':
          throw new Error('Your browser blocked the Google re-authentication pop-up. Allow pop-ups and try again.');
        case 'auth/popup-closed-by-user':
          throw new Error('Google re-authentication was cancelled.');
        case 'auth/requires-recent-login':
          throw new Error('Please sign out and sign back in, then try again.');
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
          throw new Error('Current password is incorrect.');
        default:
          throw new Error(error?.message || 'Unable to change email address.');
      }
    }
  }

  // Ensure the logged-in user has the correct role for the page
  static async requireRole(expectedRole) {
    await AuthService.waitForAuthReady();

    if (AuthService.isLocalEnvironment()) return true;

    const user = auth.currentUser;

    if (!user) {
      const idx = AuthService.getIndexPath();
      window.location.href = new URL(idx, window.location.href).href;
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
      const idx = AuthService.getIndexPath();
      window.location.href = new URL(idx, window.location.href).href;
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
      AuthService.clearPendingSessionHydration(sessionUserId);

      if (isLocal) {
          window.location.href = new URL(AuthService.buildIndexUrl(reason), window.location.href).href;
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

      window.location.href = new URL(AuthService.buildIndexUrl(reason), window.location.href).href;
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

  static getDashboardPath(targetFile) {
    if (typeof window === 'undefined') {
      return `pages/${targetFile}`;
    }

    return window.location.pathname.includes('/pages/')
      ? targetFile
      : `pages/${targetFile}`;
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
        unsubscribe = onAuthStateChanged(auth, (user) => {
          Promise.resolve(callback(user)).catch((error) => {
            console.error('Auth state change handler failed:', error);
          });
        });
      })
      .catch((error) => {
        console.error('Auth state listener setup failed:', error);
      });

    return () => unsubscribe();
  }

  // Redirect user to the correct dashboard
  static async redirectBasedOnRole(user) {

    if (!user) {
      const idx = AuthService.getIndexPath();
      window.location.href = new URL(idx, window.location.href).href;
      return {
        redirected: true,
        reason: 'missing-user',
        path: new URL(idx, window.location.href).href
      };
    }

    try {

      const role = await getUserRole(user.uid);

      // If user record exists but role is not set yet, avoid kicking the user
      // back to the login screen which creates a redirect loop.
      if (role == null || role === '') {
        console.warn('User role not found for', user.uid, '- staying on current page for manual handling.');
        try {
          showNotification('Your account does not have a dashboard role yet. Ask an admin to set your role.', 'warning');
        } catch (e) {
          console.warn('showNotification unavailable:', e);
        }
        return {
          redirected: false,
          reason: 'missing-role'
        };
      }

      let redirectPath = null;

      switch (role) {

        case "admin":
          redirectPath = AuthService.getDashboardPath('admin-dashboard.html');
          break;

        case "instructor":
          redirectPath = AuthService.getDashboardPath('instructor-dashboard.html');
          break;

        case "leader":
          redirectPath = AuthService.getDashboardPath('leader-dashboard.html');
          break;

        default:
          console.warn('Unsupported user role for dashboard redirect:', role);
          return {
            redirected: false,
            reason: 'unsupported-role',
            role
          };
      }

      const currentPage = window.location.pathname;
      const targetFile = redirectPath.split('/').pop();

      // Prevent redirect loop by comparing filenames
      if (!currentPage.endsWith(targetFile)) {
        const resolved = new URL(redirectPath, window.location.href).href;
        window.location.href = resolved;
        return {
          redirected: true,
          reason: 'navigated',
          path: resolved,
          role
        };
      }

      return {
        redirected: false,
        reason: 'already-on-target',
        path: redirectPath,
        role
      };

    } catch (error) {

      console.error("Role redirect error:", error);
      // Don't redirect to login on transient role/read errors — this can
      // cause a redirect loop if Firestore read fails or permissions are
      // temporarily unavailable. Leave the user on the current page so
      // they can retry or the client can recover.
      return {
        redirected: false,
        reason: 'lookup-error',
        error
      };

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
