// Authentication Module
// Handles login, logout, and authentication state

import { auth, firebaseSignOut } from '../firebase-config.js';

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

import { getUserRole } from './firestore.js';

export class AuthService {

  // Login user
  static async login(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      console.error("Login Error:", error);
      throw new Error("Invalid email or password.");
    }
  }

  // Ensure the logged-in user has the correct role for the page
  static async requireRole(expectedRole) {
    const isLocal = (typeof window !== 'undefined') && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) return true;

    const user = auth.currentUser;

    if (!user) {
      window.location.href = "../index.html";
      return false;
    }
  
    try {
  
      const role = await getUserRole(user.uid);
  
      if (role !== expectedRole) {
  
        // Redirect to correct dashboard
        await AuthService.redirectBasedOnRole(user);
        return false;
  
      }
  
      return true;
  
    } catch (error) {
  
      console.error("Role error:", error);
      window.location.href = "../index.html";
      return false;
  
    }
  
  }

  // Logout user
  static async logout() {
    try {
      const isLocal = (typeof window !== 'undefined') && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
      if (isLocal) {
        window.location.href = "../index.html";
        return;
      }

      await firebaseSignOut(auth);
      window.location.href = "../index.html";
    } catch (error) {
      console.error("Logout Error:", error);
      throw new Error("Logout failed.");
    }
  }

  // Get current logged-in user
  static getCurrentUser() {
    const isLocal = (typeof window !== 'undefined') && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    if (isLocal) return { uid: 'devUser' };
    return auth.currentUser;
  }

  // Listen for authentication changes
  static onAuthStateChanged(callback) {
    return onAuthStateChanged(auth, callback);
  }

  // Redirect user to the correct dashboard
  static async redirectBasedOnRole(user) {

    if (!user) {
      if (!window.location.pathname.endsWith("index.html")) {
        window.location.href = "../index.html";
      }
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

      let redirectPath = "../index.html";

      switch (role) {

        case "admin":
          redirectPath = "../pages/admin-dashboard.html";
          break;

        case "instructor":
          redirectPath = "../pages/instructor-dashboard.html";
          break;

        case "leader":
          redirectPath = "../pages/leader-dashboard.html";
          break;

        default:
          redirectPath = "../index.html";
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