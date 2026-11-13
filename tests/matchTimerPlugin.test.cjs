const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const xcode = require('xcode');
const withMatchTimerActivity = require('../plugins/withMatchTimerActivity');

test('timer sources have one group parent and separate build entries per target', async () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amatora-timer-plugin-'));
  execFileSync('tar', ['-xzf', path.join(root, 'node_modules/expo/template.tgz'), '-C', temp]);
  const iosRoot = path.join(temp, 'package/ios');
  const projectPath = path.join(iosRoot, 'HelloWorld.xcodeproj/project.pbxproj');
  const project = xcode.project(projectPath);
  project.parseSync();
  const config = withMatchTimerActivity({
    version: '1.0.0', ios: { bundleIdentifier: 'com.amatora.admin', buildNumber: '11' },
  });
  const input = { ...config, modResults: project, modRequest: {
    projectRoot: root, platformProjectRoot: iosRoot, platform: 'ios', modName: 'xcodeproj',
  } };
  await config.mods.ios.xcodeproj(input);
  const first = project.writeSync();
  await config.mods.ios.xcodeproj(input);
  assert.equal(project.writeSync(), first, 'repeated prebuild must not duplicate the target');
  fs.writeFileSync(projectPath, first);
  const parsed = xcode.project(projectPath);
  parsed.parseSync();
  const objects = parsed.hash.project.objects;
  const sources = Object.values(objects.PBXSourcesBuildPhase).filter(v => typeof v === 'object');
  const groups = Object.values(objects.PBXGroup).filter(v => typeof v === 'object');
  const timerGroup = groups.find(group => group.name === 'MatchTimerWidget');
  assert.ok(timerGroup);
  assert.equal(timerGroup.path, '.', 'source paths must resolve relative to the iOS project');
  const attributes = Object.entries(objects.PBXFileReference).find(([id, file]) =>
    !id.endsWith('_comment') && file.path?.includes('MatchTimerAttributes.swift'));
  assert.ok(attributes);
  const entries = Object.entries(objects.PBXBuildFile).filter(([id, file]) =>
    !id.endsWith('_comment') && file.fileRef === attributes[0]);
  assert.equal(entries.length, 2);
  for (const [id] of entries) {
    assert.equal(sources.filter(phase => phase.files.some(file => file.value === id)).length, 1);
  }
  for (const [id, file] of Object.entries(objects.PBXFileReference)) {
    if (!id.endsWith('_comment') && file.path?.includes('MatchTimer')) {
      assert.equal(groups.filter(group => group.children.some(child => child.value === id)).length, 1);
    }
  }
});
