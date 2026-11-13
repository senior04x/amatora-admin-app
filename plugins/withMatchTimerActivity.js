const fs = require('node:fs');
const path = require('node:path');
const { withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const name = 'MatchTimerWidget';

module.exports = function withMatchTimerActivity(config) {
  config = withInfoPlist(config, config => {
    config.modResults.NSSupportsLiveActivities = true;
    return config;
  });

  const bundleId = config.ios.bundleIdentifier + '.matchtimer';
  config.extra ??= {};
  config.extra.eas ??= {};
  config.extra.eas.build ??= {};
  config.extra.eas.build.experimental ??= {};
  config.extra.eas.build.experimental.ios ??= {};
  const iosBuild = config.extra.eas.build.experimental.ios;
  iosBuild.appExtensions ??= [];
  if (!iosBuild.appExtensions.some(extension => extension.targetName === name)) {
    iosBuild.appExtensions.push({ targetName: name, bundleIdentifier: bundleId });
  }

  return withXcodeProject(config, config => {
    const project = config.modResults;
    const iosRoot = config.modRequest.platformProjectRoot;
    const source = path.join(config.modRequest.projectRoot, 'native', 'match-activity');
    const destination = path.join(iosRoot, name);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of fs.readdirSync(source)) {
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
    }
    fs.writeFileSync(path.join(destination, name + '-Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>AMATORA Admin</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>
</dict></plist>`);

    if (project.findTargetKey(name) || project.findTargetKey(JSON.stringify(name))) return config;
    const app = project.getFirstTarget();
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const widget = project.addTarget(name, 'app_extension', name, bundleId);
    const configs = project.pbxXCBuildConfigurationSection();
    const lists = project.pbxXCConfigurationList();
    const appConfigs = lists[app.firstTarget.buildConfigurationList].buildConfigurations;
    for (const entry of lists[widget.pbxNativeTarget.buildConfigurationList].buildConfigurations) {
      const appEntry = appConfigs.find(appEntry => appEntry.comment === entry.comment);
      const appSettings = configs[appEntry.value].buildSettings;
      Object.assign(configs[entry.value].buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        CURRENT_PROJECT_VERSION: appSettings.CURRENT_PROJECT_VERSION ?? config.ios.buildNumber ?? '1',
        DEVELOPMENT_TEAM: config.ios.appleTeamId ?? appSettings.DEVELOPMENT_TEAM,
        IPHONEOS_DEPLOYMENT_TARGET: '16.2',
        MARKETING_VERSION: appSettings.MARKETING_VERSION ?? config.version,
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: appSettings.TARGETED_DEVICE_FAMILY ?? '"1,2"',
      });
    }
    const group = project.addPbxGroup([], name, '.');
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    const attributes = project.addSourceFile(
      name + '/MatchTimerAttributes.swift', { target: app.uuid }, group.uuid,
    );
    project.addSourceFile(name + '/MatchTimerActivity.swift', { target: app.uuid }, group.uuid);
    project.addSourceFile(name + '/MatchTimerActivityBridge.m', { target: app.uuid }, group.uuid);
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', widget.uuid);
    // A shared file reference needs a distinct PBXBuildFile for each target.
    // addBuildPhase(paths) reuses the app's build-file entry across both phases.
    const widgetAttributes = {
      ...attributes, uuid: project.generateUuid(), target: widget.uuid,
    };
    project.addToPbxBuildFileSection(widgetAttributes);
    project.addToPbxSourcesBuildPhase(widgetAttributes);
    project.addSourceFile(name + '/MatchTimerWidget.swift', { target: widget.uuid }, group.uuid);
    return config;
  });
};
