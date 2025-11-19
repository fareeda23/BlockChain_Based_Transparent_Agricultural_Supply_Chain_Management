const { spawn } = require('child_process');
const path = require('path');

function runPythonCheck(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'ml', 'price_model.py');
    const candidates = ['python', 'python3', 'py'];
    let attempted = 0;
    let lastErr = null;

    function tryNext() {
      if (attempted >= candidates.length) {
        return reject(lastErr || new Error('Python not found'));
      }

      const cmd = candidates[attempted++];
      const py = spawn(cmd, [scriptPath, 'check', JSON.stringify(payload)], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let producedOutput = false;

      py.stdout.on('data', (chunk) => {
        producedOutput = true;
        stdout += chunk.toString();
      });

      py.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      py.on('error', (err) => {
        lastErr = err;
        tryNext();
      });

      py.on('close', (code) => {
        if (!producedOutput && code !== 0) {
          lastErr = new Error(stderr || `Python exited with ${code}`);
          return tryNext();
        }
        if (code !== 0) {
          return reject(new Error(stderr || `Python exited with ${code}`));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (err) {
          reject(new Error('Invalid JSON from Python'));
        }
      });
    }

    tryNext();
  });
}

module.exports = runPythonCheck;


