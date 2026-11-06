'use strict';

function childExitCode(result) {
  return Number.isInteger(result?.status) ? result.status : 1;
}

module.exports = { childExitCode };
