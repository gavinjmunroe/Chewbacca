Pod::Spec.new do |s|
  s.name           = 'AmberPermissions'
  s.version        = '1.0.0'
  s.summary        = 'Individual Apple device permission requests for Amber'
  s.description    = 'Foreground location, selected photos and fitness authorization. Read-only daily Health summaries with explicit private saving.'
  s.author         = 'Amber'
  s.homepage       = 'https://joinrytual.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreLocation', 'Photos', 'CoreMotion'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
