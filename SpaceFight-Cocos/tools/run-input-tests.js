'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { childExitCode } = require('./process-status.js');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-cocos-input-'));
const compilerArguments = [
  '--yes', '--package', 'typescript@4.9.5', 'tsc',
  '--target', 'ES2020', '--module', 'commonjs', '--moduleResolution', 'node',
  '--strict', '--skipLibCheck', '--lib', 'ES2020,DOM',
  '--rootDir', path.join(projectRoot, 'assets', 'scripts'),
  '--outDir', outputRoot,
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightCommand.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'InputSettings.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'DesktopFlightInput.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'TouchStickFeedback.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'TouchFlightInput.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'GamepadFlightInput.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'InputRouter.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'input', 'BrowserInputBridge.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'platform', 'PlatformBridge.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'platform', 'WebPlatformBridge.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'platform', 'NativePlatformBridge.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'platform', 'PlatformBootstrap.ts'),
];

try {
  const compile = spawnSync('npx', compilerArguments, { cwd: projectRoot, encoding: 'utf8' });
  if (compile.status !== 0) {
    process.stderr.write(`${compile.stdout}${compile.stderr}`);
    process.exitCode = childExitCode(compile);
  } else {
    const tests = spawnSync(process.execPath, [
      '--test',
      path.join(repositoryRoot, 'tests', 'spacefight_cocos_input.test.js'),
      path.join(repositoryRoot, 'tests', 'spacefight_platform_bridge.test.js'),
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPACEFIGHT_COCOS_COMPILED_INPUT: path.join(outputRoot, 'input'),
        SPACEFIGHT_COCOS_COMPILED_PLATFORM: path.join(outputRoot, 'platform'),
      },
      stdio: 'inherit',
    });
    process.exitCode = childExitCode(tests);
  }
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
