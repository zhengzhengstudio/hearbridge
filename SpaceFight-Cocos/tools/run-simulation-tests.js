'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { childExitCode } = require('./process-status.js');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const outputRoot = mkdtempSync(path.join(os.tmpdir(), 'spacefight-cocos-core-'));
const compilerArguments = [
  '--yes',
  '--package',
  'typescript@4.9.5',
  'tsc',
  '--target',
  'ES2020',
  '--module',
  'commonjs',
  '--moduleResolution',
  'node',
  '--strict',
  '--skipLibCheck',
  '--lib',
  'ES2020,DOM',
  '--rootDir',
  path.join(projectRoot, 'assets', 'scripts'),
  '--outDir',
  outputRoot,
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightCommand.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightAttitude.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'FlightTuning.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'ExpeditionDirector.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'EnemyBehaviorSystem.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'LootAndCargoSystem.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'WeaponCatalog.ts'),
  path.join(projectRoot, 'assets', 'scripts', 'core', 'CombatSimulation.ts'),
];

try {
  const compile = spawnSync('npx', compilerArguments, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (compile.status !== 0) {
    process.stderr.write(`${compile.stdout}${compile.stderr}`);
    process.exitCode = childExitCode(compile);
  } else {
    process.stdout.write('TypeScript 4.9.5 compatibility compile passed.\n');
    const tests = spawnSync(process.execPath, [
      '--test',
      path.join(repositoryRoot, 'tests', 'spacefight_cocos_simulation.test.js'),
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SPACEFIGHT_COCOS_COMPILED_CORE: path.join(outputRoot, 'core'),
      },
      stdio: 'inherit',
    });
    process.exitCode = childExitCode(tests);
  }
} finally {
  rmSync(outputRoot, { recursive: true, force: true });
}
