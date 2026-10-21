const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const block = "    # Amber: select the prebuilt core by Xcode configuration, not inherited C flags.\n    installer.pods_project.targets.each do |target|\n      next unless target.name == 'React-Core-prebuilt'\n      target.shell_script_build_phases.each do |phase|\n        next unless phase.shell_script&.include?('replace-rncore-version.js')\n        phase.shell_script = phase.shell_script.gsub('if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q \"DEBUG=1\"; then', 'if [ \"$CONFIGURATION\" = \"Debug\" ]; then')\n      end\n    end\n";
module.exports = config => withDangerousMod(config, ['ios', async mod => {
 const file=path.join(mod.modRequest.platformProjectRoot,'Podfile');
 let text=fs.readFileSync(file,'utf8');
 if(!text.includes('# Amber: select the prebuilt core')) {
  if(!text.includes('  post_install do |installer|')) throw Error('Could not locate CocoaPods post-install hook');
  text=text.replace('  post_install do |installer|','  post_install do |installer|\n'+block);
  fs.writeFileSync(file,text);
 }
 return mod;
}]);
