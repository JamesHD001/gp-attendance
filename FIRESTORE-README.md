# Firestore Rules — Test & Deploy

This document explains how to validate and deploy the project's `firestore.rules` using the Firebase CLI and the Firebase Console rules simulator.

Prerequisites

- Node.js (14+ recommended)
- Firebase CLI installed globally:

```bash
npm install -g firebase-tools
```

Quick steps

1. Authenticate with Firebase:

```bash
firebase login
```

1. (Optional) Initialize Firebase in this project if you haven't already. This will create a `firebase.json` and `.firebaserc`.

```bash
firebase init firestore
```

1. Start the Firestore emulator to load and validate rules locally:

```bash
firebase emulators:start --only firestore
```

The emulator will attempt to load `firestore.rules` from the project root. Syntax errors or rule evaluation errors will be printed to the console.

1. Use the Firebase Console Rules Playground to simulate reads/writes:

- Go to the Firebase Console → Firestore → Rules → "Rules playground".  
- Choose an authenticated user (set `request.auth.uid`) and simulate reads/writes against your paths and documents to verify access.

1. Deploy the rules to your Firebase project (once validated):

```bash
firebase deploy --only firestore:rules
```

Advanced: automated rule unit tests

- For thorough testing, write unit tests using the `@firebase/rules-unit-testing` library and run them with the emulator. Example workflow:

```bash
npm install --save-dev @firebase/rules-unit-testing
node test/firestore-rules.test.js   # your test runner script, using the library
```

Notes & recommendations

- Always validate changes with the emulator or the console simulator before deploying production rules.  
- Keep a copy of the current `firestore.rules` backed up or versioned (git) before making large changes.  
- The repo already contains `firestore.rules` at the project root — use that file when testing or deploying.
