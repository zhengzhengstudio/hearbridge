'use strict';

function target(id, platform, packageName, offline, configPath) {
  return Object.freeze({
    id,
    platform,
    configPath,
    outputName: `spacefight-${id}`,
    packageName,
    offline,
  });
}

const NATIVE_TARGETS = Object.freeze({
  android: target(
    'android',
    'android',
    'cn.zhengzhengstudio.spacefight',
    false,
    'config/build-android-foundation.json',
  ),
  ios: target(
    'ios',
    'ios',
    'cn.zhengzhengstudio.spacefight',
    false,
    'config/build-ios-foundation.json',
  ),
  mac: target(
    'mac',
    'mac',
    'cn.zhengzhengstudio.spacefight',
    false,
    'config/build-mac-foundation.json',
  ),
  harmonyos: target(
    'harmonyos',
    'harmonyos-next',
    'cn.zhengzhengstudio.spacefight.hmos',
    false,
    'config/build-harmony-foundation.json',
  ),
  'harmonyos-offline': target(
    'harmonyos-offline',
    'harmonyos-next',
    'cn.zhengzhengstudio.spacefight.huawei',
    true,
    'config/build-harmony-offline-foundation.json',
  ),
});

module.exports = {
  NATIVE_TARGETS,
};
