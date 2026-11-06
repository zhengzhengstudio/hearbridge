const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectManifestPackagePaths,
  collectProductReleaseFiles,
  remoteArtifactMatches
} = require('../website/api/lib/app_release_files');

test('remote artifact verification compares content instead of trusting equal sizes', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-artifact-'));
  test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const localPath = path.join(tempDir, 'app.apk');
  fs.writeFileSync(localPath, 'correct-package');

  const server = http.createServer((req, res) => {
    const body = req.url === '/same' ? 'correct-package' : 'wrong---package';
    res.setHeader('Content-Length', Buffer.byteLength(body));
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  test.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  assert.equal(await remoteArtifactMatches(`${origin}/same`, localPath), true);
  assert.equal(await remoteArtifactMatches(`${origin}/different`, localPath), false);
});

test('watch package discovery accepts packages from every product without a filename allowlist', () => {
  const packages = collectManifestPackagePaths([
    {
      product: 'lifediary',
      fileName: 'LifeDiary-Android-v0.2.0-b2-unsigned.apk',
      latestUrl: '/api/apps/download/LifeDiary-Android-latest-unsigned.apk'
    },
    {
      product: 'future-product',
      fileName: 'FutureClient-v1.0.0.pkg',
      versionedUrl: '/api/apps/releases/FutureClient-v1.0.0.pkg'
    }
  ]);

  assert.deepEqual([...packages].sort(), [
    'LifeDiary-Android-latest-unsigned.apk',
    'LifeDiary-Android-v0.2.0-b2-unsigned.apk',
    'releases/FutureClient-v1.0.0.pkg',
    'FutureClient-v1.0.0.pkg'
  ].sort());
});

test('focused LifeDiary release collects both distribution roots and checksum sidecars', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifediary-release-'));
  test.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const metadata = {
    apps: [
      {
        product: 'lifediary',
        fileName: 'LifeDiary-iOS-v0.2.0-b2-unsigned.ipa',
        latestUrl: '/api/apps/download/LifeDiary-iOS-latest-unsigned.ipa'
      },
      {
        product: 'survival-diary',
        fileName: 'SurvivalDiary-Android-v1.0.0.apk'
      }
    ]
  };
  const metadataPath = path.join(projectRoot, 'website/api/apps/client-downloads.json');
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));

  for (const prefix of ['api/apps', 'zhengzhengstudio.cn/api/apps']) {
    const root = path.join(projectRoot, 'website', prefix);
    fs.mkdirSync(root, { recursive: true });
    for (const file of [
      'LifeDiary-iOS-v0.2.0-b2-unsigned.ipa',
      'LifeDiary-iOS-latest-unsigned.ipa'
    ]) {
      fs.writeFileSync(path.join(root, file), 'package');
      fs.writeFileSync(path.join(root, `${file}.sha256`), 'digest');
    }
  }

  const files = collectProductReleaseFiles({
    projectRoot,
    product: 'lifediary',
    metadataPath
  });
  const remotePaths = files.map(item => item.remotePath).sort();

  assert.deepEqual(remotePaths, [
    'api/apps/LifeDiary-iOS-latest-unsigned.ipa',
    'api/apps/LifeDiary-iOS-latest-unsigned.ipa.sha256',
    'api/apps/LifeDiary-iOS-v0.2.0-b2-unsigned.ipa',
    'api/apps/LifeDiary-iOS-v0.2.0-b2-unsigned.ipa.sha256',
    'zhengzhengstudio.cn/api/apps/LifeDiary-iOS-latest-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/LifeDiary-iOS-latest-unsigned.ipa.sha256',
    'zhengzhengstudio.cn/api/apps/LifeDiary-iOS-v0.2.0-b2-unsigned.ipa',
    'zhengzhengstudio.cn/api/apps/LifeDiary-iOS-v0.2.0-b2-unsigned.ipa.sha256'
  ].sort());
});

test('focused release refuses to switch metadata when any referenced package is missing', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifediary-incomplete-release-'));
  test.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const metadataPath = path.join(projectRoot, 'website/api/apps/client-downloads.json');
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify({
    apps: [{
      product: 'lifediary',
      fileName: 'LifeDiary-Android-v0.2.0.apk',
      latestUrl: '/api/apps/download/LifeDiary-Android-latest.apk'
    }]
  }));

  assert.throws(
    () => collectProductReleaseFiles({ projectRoot, product: 'lifediary', metadataPath }),
    /缺少发布安装包.*LifeDiary-Android/
  );
});
