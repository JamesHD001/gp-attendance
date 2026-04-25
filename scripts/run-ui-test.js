const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.UI_TEST_PORT || 3001);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function resolvePath(urlPath) {
  const requestedPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const fullPath = path.resolve(rootDir, relativePath);

  if (!fullPath.startsWith(rootDir)) {
    return null;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    return path.join(fullPath, 'index.html');
  }

  return fullPath;
}

function createServer() {
  return http.createServer((req, res) => {
    const filePath = resolvePath(req.url);
    if (!filePath || !fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
}

async function main() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const child = spawn(process.execPath, [path.join(rootDir, 'test', 'ui.navigation.test.js')], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      BASE_URL: `http://127.0.0.1:${port}`
    }
  });

  child.on('exit', (code) => {
    server.close(() => {
      process.exit(code || 0);
    });
  });

  child.on('error', (error) => {
    console.error(error);
    server.close(() => {
      process.exit(1);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
