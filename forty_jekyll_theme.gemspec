# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = 'forty_jekyll_theme'
  spec.version       = '1.2'
  spec.authors       = ['Andrew Banchich']
  spec.email         = ['andrewbanchich@gmail.com']

  spec.summary       = 'A Jekyll version of the "Forty" theme by HTML5 UP.'
  spec.homepage      = 'https://andrewbanchich.github.io/forty-jekyll-theme/'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 2.7.0'

  spec.files         = `git ls-files -z`.split("\x0").select do |f|
                         f.match(/^(assets|_layouts|_includes|_sass|LICENSE|README)/i)
                       end

  spec.add_development_dependency 'bundler', '~> 2.2'
  spec.add_development_dependency 'jekyll', '~> 4.0'
end
