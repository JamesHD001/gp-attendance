# YSA GP Attendance System - Setup Guide

## ⚡ 5-Minute Quick Start

### Step 1: Clone or Download Project

```bash
git clone https://github.com/YOUR_USERNAME/gp-attendance.git
cd gp-attendance
```

This page explains how to configure Firebase locally without committing secrets.

## Quick local config (recommended)

1. Copy the example `.env` into a real `.env` at project root:

   - Windows (PowerShell):

     ```powershell
     copy .env.example .env
     ```

   - macOS / Linux:

     ```bash
     cp .env.example .env
     ```

2. Edit `.env` and fill your Firebase values (API key, project id, etc.).

3. Generate the local JS config file (creates `js/modules/firebase-config.local.js` which is gitignored):

   ```bash
   # using node directly
   node scripts/generate-firebase-config.js

   # or via npm script
   npm run gen-config
   ```

4. Serve or open `index.html` in your browser. The app will import the generated local config.

Notes:

- The generator reads `.env` and writes `js/modules/firebase-config.local.js` (ignored by git).
- If the local config is missing the app falls back to placeholder values and prints a console warning.

## Why this approach

- Keeps real API keys out of the repo and prevents accidental commits.  
- Simple workflow for local development: edit `.env` once, generate, and the app will pick it up.

## NPM helper

I added a small `package.json` with a helper script:

```json
{
  "scripts": {
    "gen-config": "node scripts/generate-firebase-config.js"
  }
}
```

Run `npm run gen-config` to generate the local config from your `.env` file.

## Remaining original setup steps

Follow the rest of the original setup (creating Firebase project, enabling Authentication, Firestore rules, creating test users) as previously documented in the project README. The `.env` + generator only replaces manual edits to `js/modules/firebase-config.js`.
