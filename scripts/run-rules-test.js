const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
      env
    });

    child.on('exit', (code) => resolve(code || 0));
    child.on('error', reject);
  });
}

function runCommandString(command, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
      env
    });

    child.on('exit', (code) => resolve(code || 0));
    child.on('error', reject);
  });
}

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const code = await run(process.execPath, [path.join(rootDir, 'test', 'firestore.rules.test.js')]);
    process.exit(code);
  }

  try {
    const code = await runCommandString('npx firebase emulators:exec --only firestore "node test/firestore.rules.test.js"');
    process.exit(code);
  } catch (error) {
    console.error('Unable to start the Firestore emulator automatically.');
    console.error('Install Firebase CLI or run with FIRESTORE_EMULATOR_HOST set.');
    console.error(error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
