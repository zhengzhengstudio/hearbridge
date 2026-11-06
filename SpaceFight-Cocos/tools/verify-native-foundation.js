'use strict';

const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { NATIVE_TARGETS } = require('./native-targets');
const { validateEvidence } = require('./build-native-target');

const projectRoot = path.resolve(__dirname, '..');
const defaultEvidenceDirectory = path.join(projectRoot, 'native-build', 'evidence');

function verifyEvidenceDirectory(directory = defaultEvidenceDirectory) {
  return Object.keys(NATIVE_TARGETS).map((target) => {
    const evidencePath = path.join(directory, `${target}.json`);
    if (!existsSync(evidencePath)) throw new Error(`Missing native evidence: ${target}`);
    return validateEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')));
  });
}

if (require.main === module) {
  try {
    const evidence = verifyEvidenceDirectory();
    console.log(`Verified ${evidence.length} Cocos native foundation exports.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { verifyEvidenceDirectory };
