# [0.28.0](https://github.com/kapetacom/local-cluster-service/compare/v0.27.0...v0.28.0) (2023-11-15)


### Features

* Auto-upgrade providers every 10th minute ([#100](https://github.com/kapetacom/local-cluster-service/issues/100)) ([2c35569](https://github.com/kapetacom/local-cluster-service/commit/2c35569587f456374529bb1f9a9e8f5c03be2189))

# [0.27.0](https://github.com/kapetacom/local-cluster-service/compare/v0.26.0...v0.27.0) (2023-11-13)


### Features

* add /files/release-channel endpoint to enable beta releases in the app [KAP-2014] ([#99](https://github.com/kapetacom/local-cluster-service/issues/99)) ([096b4be](https://github.com/kapetacom/local-cluster-service/commit/096b4bea99d0e0ccf11f2ef04730737adb2995a3))

# [0.26.0](https://github.com/kapetacom/local-cluster-service/compare/v0.25.4...v0.26.0) (2023-11-13)


### Features

* Add storage field for editor ([#98](https://github.com/kapetacom/local-cluster-service/issues/98)) ([e81ef2f](https://github.com/kapetacom/local-cluster-service/commit/e81ef2f3e68e5ad7171fc3256bcfd96b515715ac))

## [0.25.4](https://github.com/kapetacom/local-cluster-service/compare/v0.25.3...v0.25.4) (2023-11-12)


### Bug Fixes

* Get rid of native node module ([ce9a7f2](https://github.com/kapetacom/local-cluster-service/commit/ce9a7f2eba8f86ebbd76e6a5d0ad282858361753))

## [0.25.3](https://github.com/kapetacom/local-cluster-service/compare/v0.25.2...v0.25.3) (2023-11-12)


### Bug Fixes

* Avoid sentry request handler - causes node crash ([0f004dd](https://github.com/kapetacom/local-cluster-service/commit/0f004dd98d31e07476cf9db011b32a2184fe3f96))

## [0.25.2](https://github.com/kapetacom/local-cluster-service/compare/v0.25.1...v0.25.2) (2023-11-12)


### Bug Fixes

* Add sentry ([#97](https://github.com/kapetacom/local-cluster-service/issues/97)) ([e823e36](https://github.com/kapetacom/local-cluster-service/commit/e823e36f505965fbfa086c997ef70e91d7e3dbe1))

## [0.25.1](https://github.com/kapetacom/local-cluster-service/compare/v0.25.0...v0.25.1) (2023-11-02)


### Bug Fixes

* open up web-microfrontend version range ([b0f55d6](https://github.com/kapetacom/local-cluster-service/commit/b0f55d6c24183f7db6e79f6351e3e4d2cc70dbb0))

# [0.25.0](https://github.com/kapetacom/local-cluster-service/compare/v0.24.3...v0.25.0) (2023-11-01)


### Bug Fixes

* Disable eslint rule ([bcfe9bc](https://github.com/kapetacom/local-cluster-service/commit/bcfe9bc5835aff3de73b6ecfc7beab2df290b65a))
* Refactor .catch to try catch ([21101b2](https://github.com/kapetacom/local-cluster-service/commit/21101b274b7bb573afd14d11833bbfa63708edc0))
* Rename blockctl to kap in error message ([52b843d](https://github.com/kapetacom/local-cluster-service/commit/52b843db7f593381042b6adbd876451e5b819232))
* Run kap init without using a task ([d6975e1](https://github.com/kapetacom/local-cluster-service/commit/d6975e1dfb5518b7b8194351ddd7759d9a8e397a))
* Run kap:init without checking if commands exist ([159db0a](https://github.com/kapetacom/local-cluster-service/commit/159db0afdb2bc1d01e853900ff9b16de20ecfb86))
* Wait for ensureCLI to finish before calling ensureCLICommands ([178e387](https://github.com/kapetacom/local-cluster-service/commit/178e387df9c7b5e5aa975d4ee6c30112f624efcb))


### Features

* Run kap init if any of the default commands are missing ([671f19c](https://github.com/kapetacom/local-cluster-service/commit/671f19cfa76408beed7818bdbc56915714d55f0c))

## [0.24.3](https://github.com/kapetacom/local-cluster-service/compare/v0.24.2...v0.24.3) (2023-10-28)


### Bug Fixes

* Handle renaming of local assets ([#92](https://github.com/kapetacom/local-cluster-service/issues/92)) ([2a8d278](https://github.com/kapetacom/local-cluster-service/commit/2a8d2785ae45f548333d6a177ed6b6096fa39c3c))

## [0.24.2](https://github.com/kapetacom/local-cluster-service/compare/v0.24.1...v0.24.2) (2023-10-27)


### Bug Fixes

* Do not ensure when unregistering ([#91](https://github.com/kapetacom/local-cluster-service/issues/91)) ([3957d51](https://github.com/kapetacom/local-cluster-service/commit/3957d513ce3fd9064a36cea438967ae5a0a50720))

## [0.24.1](https://github.com/kapetacom/local-cluster-service/compare/v0.24.0...v0.24.1) (2023-10-27)


### Bug Fixes

* increase timeout to try to compensate for slow machines ([#89](https://github.com/kapetacom/local-cluster-service/issues/89)) ([98f243f](https://github.com/kapetacom/local-cluster-service/commit/98f243fddf5ab827cc5fbb91e5bfd972a2137ea9))

# [0.24.0](https://github.com/kapetacom/local-cluster-service/compare/v0.23.0...v0.24.0) (2023-10-27)


### Features

* Add endpoint for getting all installed versions for asset ([#90](https://github.com/kapetacom/local-cluster-service/issues/90)) ([fc593ba](https://github.com/kapetacom/local-cluster-service/commit/fc593babec99a7a67d6b6855c93546eb6cadd461))

# [0.23.0](https://github.com/kapetacom/local-cluster-service/compare/v0.22.2...v0.23.0) (2023-10-24)


### Features

* Make it possible to wait for installation to complete from the UI ([#88](https://github.com/kapetacom/local-cluster-service/issues/88)) ([f34c807](https://github.com/kapetacom/local-cluster-service/commit/f34c807d260264e85d770dc1575d0458feae2bae))

## [0.22.2](https://github.com/kapetacom/local-cluster-service/compare/v0.22.1...v0.22.2) (2023-10-22)


### Bug Fixes

* Use quick chat as sample instead ([#87](https://github.com/kapetacom/local-cluster-service/issues/87)) ([de7e2ff](https://github.com/kapetacom/local-cluster-service/commit/de7e2ff9371cc89ca6cbe76bf46d99f802c816ff))

## [0.22.1](https://github.com/kapetacom/local-cluster-service/compare/v0.22.0...v0.22.1) (2023-10-21)


### Bug Fixes

* Bump kapeta api to fix auth ([#86](https://github.com/kapetacom/local-cluster-service/issues/86)) ([1178afc](https://github.com/kapetacom/local-cluster-service/commit/1178afce54a25cddb52944201097bc28c59b038a))

# [0.22.0](https://github.com/kapetacom/local-cluster-service/compare/v0.21.5...v0.22.0) (2023-10-17)


### Features

* Allow local containers to add Binds ([#85](https://github.com/kapetacom/local-cluster-service/issues/85)) ([c7b46e9](https://github.com/kapetacom/local-cluster-service/commit/c7b46e94412da1eec82503f7d30957fc665e71e6))

## [0.21.5](https://github.com/kapetacom/local-cluster-service/compare/v0.21.4...v0.21.5) (2023-09-26)


### Bug Fixes

* handle bad token in current identity API ([#84](https://github.com/kapetacom/local-cluster-service/issues/84)) ([60ca70d](https://github.com/kapetacom/local-cluster-service/commit/60ca70d9f6aa5747d89110b03f56fae70f1c7f24))

## [0.21.4](https://github.com/kapetacom/local-cluster-service/compare/v0.21.3...v0.21.4) (2023-09-21)


### Bug Fixes

* Make local sample copy private ([#83](https://github.com/kapetacom/local-cluster-service/issues/83)) ([e9591b7](https://github.com/kapetacom/local-cluster-service/commit/e9591b76f18f62e258a71a9ea10ccd28c9d51786))

## [0.21.3](https://github.com/kapetacom/local-cluster-service/compare/v0.21.2...v0.21.3) (2023-09-20)


### Bug Fixes

* Clean up empty folders after codegen ([#82](https://github.com/kapetacom/local-cluster-service/issues/82)) ([f9185aa](https://github.com/kapetacom/local-cluster-service/commit/f9185aad168d769617bc790c825c5b901ce5f41d))

## [0.21.2](https://github.com/kapetacom/local-cluster-service/compare/v0.21.1...v0.21.2) (2023-09-19)


### Bug Fixes

* Handle windows paths in watcher ([#81](https://github.com/kapetacom/local-cluster-service/issues/81)) ([a2b7c3d](https://github.com/kapetacom/local-cluster-service/commit/a2b7c3dc9efba4d1b6d0a1a64703f7cf40ea3278))

## [0.21.1](https://github.com/kapetacom/local-cluster-service/compare/v0.21.0...v0.21.1) (2023-09-19)


### Bug Fixes

* Use mounts and real paths - otherwise it fails on windows ([#80](https://github.com/kapetacom/local-cluster-service/issues/80)) ([8e73fdd](https://github.com/kapetacom/local-cluster-service/commit/8e73fddbaafcbcef547a72fd78f2b063ceed10b8))

# [0.21.0](https://github.com/kapetacom/local-cluster-service/compare/v0.20.4...v0.21.0) (2023-09-17)


### Features

* Use default ports from block type providers ([#79](https://github.com/kapetacom/local-cluster-service/issues/79)) ([4633a7e](https://github.com/kapetacom/local-cluster-service/commit/4633a7ee4da92aeb3b43b5f93898d443f6de1f04))

## [0.20.4](https://github.com/kapetacom/local-cluster-service/compare/v0.20.3...v0.20.4) (2023-09-14)


### Bug Fixes

* bump/open up kapeta/schemas dependency range ([#78](https://github.com/kapetacom/local-cluster-service/issues/78)) ([4b5b7e1](https://github.com/kapetacom/local-cluster-service/commit/4b5b7e1c777b686f1190c27eb1184385659abfbc))

## [0.20.3](https://github.com/kapetacom/local-cluster-service/compare/v0.20.2...v0.20.3) (2023-09-12)


### Bug Fixes

* Resolve configuration when returning it for instance ([#77](https://github.com/kapetacom/local-cluster-service/issues/77)) ([e1f9ee6](https://github.com/kapetacom/local-cluster-service/commit/e1f9ee62877efcd87b8c5b21c42609f10842ece2))

## [0.20.2](https://github.com/kapetacom/local-cluster-service/compare/v0.20.1...v0.20.2) (2023-09-12)


### Bug Fixes

* bump nodejs-registry-utils dependency ([408ec86](https://github.com/kapetacom/local-cluster-service/commit/408ec865791b7fd10170c3e27c1a174b8052d9c2))

## [0.20.1](https://github.com/kapetacom/local-cluster-service/compare/v0.20.0...v0.20.1) (2023-09-12)


### Bug Fixes

* return realpaths for assets from assetManager ([7a1f315](https://github.com/kapetacom/local-cluster-service/commit/7a1f3159a8c54fda59ff57764d2b539016c091e4))

# [0.20.0](https://github.com/kapetacom/local-cluster-service/compare/v0.19.7...v0.20.0) (2023-09-10)


### Features

* Add support for block instance default configuration ([#73](https://github.com/kapetacom/local-cluster-service/issues/73)) ([7ea0f94](https://github.com/kapetacom/local-cluster-service/commit/7ea0f94a3167f14453e6c45aab7501181bff7398))

## [0.19.7](https://github.com/kapetacom/local-cluster-service/compare/v0.19.6...v0.19.7) (2023-09-10)


### Bug Fixes

* Replaced node-docker-api with dockerode and types ([#72](https://github.com/kapetacom/local-cluster-service/issues/72)) ([3d4894c](https://github.com/kapetacom/local-cluster-service/commit/3d4894c6f78dc6efe5e75587d6463f33a86ded62))

## [0.19.6](https://github.com/kapetacom/local-cluster-service/compare/v0.19.5...v0.19.6) (2023-09-08)


### Bug Fixes

* Allow more docker opts from language targets ([#71](https://github.com/kapetacom/local-cluster-service/issues/71)) ([dd9e9bb](https://github.com/kapetacom/local-cluster-service/commit/dd9e9bb91fb6aa6d082b1864b268234ece9b8920))

## [0.19.5](https://github.com/kapetacom/local-cluster-service/compare/v0.19.4...v0.19.5) (2023-09-07)


### Bug Fixes

* Handle query and hash in path matching ([#70](https://github.com/kapetacom/local-cluster-service/issues/70)) ([e743cf8](https://github.com/kapetacom/local-cluster-service/commit/e743cf80c6754f43c948fd25967f04808429a784))

## [0.19.4](https://github.com/kapetacom/local-cluster-service/compare/v0.19.3...v0.19.4) (2023-09-05)


### Bug Fixes

* Do not rename local sample if we already have ([095737e](https://github.com/kapetacom/local-cluster-service/commit/095737e7cfd94ec1e5dc8efcb178fbf88f67d783))

## [0.19.3](https://github.com/kapetacom/local-cluster-service/compare/v0.19.2...v0.19.3) (2023-09-05)


### Bug Fixes

* if codegen is already started for block - run after ([#69](https://github.com/kapetacom/local-cluster-service/issues/69)) ([a1b13ee](https://github.com/kapetacom/local-cluster-service/commit/a1b13eeab8413be8c165419ee36c26e3509338b4))

## [0.19.2](https://github.com/kapetacom/local-cluster-service/compare/v0.19.1...v0.19.2) (2023-09-05)


### Bug Fixes

* Control boot order and reload code gen targets when repo changes ([#68](https://github.com/kapetacom/local-cluster-service/issues/68)) ([5557259](https://github.com/kapetacom/local-cluster-service/commit/5557259dda10f509a2b8cc45c0b4a4631e1d975a))

## [0.19.1](https://github.com/kapetacom/local-cluster-service/compare/v0.19.0...v0.19.1) (2023-09-03)


### Bug Fixes

* Removed debug ([feeac46](https://github.com/kapetacom/local-cluster-service/commit/feeac462856a6a375d0f80e1098a25bbcaba0a70))

# [0.19.0](https://github.com/kapetacom/local-cluster-service/compare/v0.18.0...v0.19.0) (2023-09-03)


### Features

* Listen for docker logs when user joins room ([#67](https://github.com/kapetacom/local-cluster-service/issues/67)) ([53bd6b6](https://github.com/kapetacom/local-cluster-service/commit/53bd6b6b6de27dc2f9011887176f270d60a0d9dc))

# [0.18.0](https://github.com/kapetacom/local-cluster-service/compare/v0.17.0...v0.18.0) (2023-09-02)


### Features

* Auto-rename sample plan when available ([#66](https://github.com/kapetacom/local-cluster-service/issues/66)) ([d95b844](https://github.com/kapetacom/local-cluster-service/commit/d95b844baff7e5bfceb354c854526881051f2308))

# [0.17.0](https://github.com/kapetacom/local-cluster-service/compare/v0.16.8...v0.17.0) (2023-09-02)


### Bug Fixes

* Bump dependencies ([273a75b](https://github.com/kapetacom/local-cluster-service/commit/273a75b4727cbfc19fa186849a81aebba9b85b00))
* TS 5.2 is more strict with build options ([d5a27be](https://github.com/kapetacom/local-cluster-service/commit/d5a27bed4d89d1ed557517b5ae9bfcc1dccabbb0))


### Features

* Add default provider and sample installations ([#65](https://github.com/kapetacom/local-cluster-service/issues/65)) ([ea4fe89](https://github.com/kapetacom/local-cluster-service/commit/ea4fe899988cbbaeb5a1020517e7e88ac967e6b9))

## [0.16.8](https://github.com/kapetacom/local-cluster-service/compare/v0.16.7...v0.16.8) (2023-08-30)


### Bug Fixes

* Gracefully handled instances that have been deleted ([#64](https://github.com/kapetacom/local-cluster-service/issues/64)) ([e26ed35](https://github.com/kapetacom/local-cluster-service/commit/e26ed353e474b7417939008fb1eadec891d5ead9))

## [0.16.7](https://github.com/kapetacom/local-cluster-service/compare/v0.16.6...v0.16.7) (2023-08-24)


### Bug Fixes

* Load JS from provider endpoints if not available locally ([#63](https://github.com/kapetacom/local-cluster-service/issues/63)) ([83c7cb4](https://github.com/kapetacom/local-cluster-service/commit/83c7cb4a176a2b23ee5bf5e8a312e8a64abd9ea6))

## [0.16.6](https://github.com/kapetacom/local-cluster-service/compare/v0.16.5...v0.16.6) (2023-08-21)


### Bug Fixes

* Add timeout when testing docker ([#62](https://github.com/kapetacom/local-cluster-service/issues/62)) ([c6e373e](https://github.com/kapetacom/local-cluster-service/commit/c6e373eab81f466b5a4fd8dbd9ca9f085f9b91de))

## [0.16.5](https://github.com/kapetacom/local-cluster-service/compare/v0.16.4...v0.16.5) (2023-08-14)


### Bug Fixes

* Avoid detached spawn ([5114bed](https://github.com/kapetacom/local-cluster-service/commit/5114bed57158808fa9856f0975a5226b6c9ed154))

## [0.16.4](https://github.com/kapetacom/local-cluster-service/compare/v0.16.3...v0.16.4) (2023-08-14)


### Bug Fixes

* Avoid multiple layers of cache ([#61](https://github.com/kapetacom/local-cluster-service/issues/61)) ([e8efcd2](https://github.com/kapetacom/local-cluster-service/commit/e8efcd26184c792a8798781eb6bd9952ccfa0fec))

## [0.16.3](https://github.com/kapetacom/local-cluster-service/compare/v0.16.2...v0.16.3) (2023-08-14)


### Bug Fixes

* Add route for getting status for a single instance ([00159e2](https://github.com/kapetacom/local-cluster-service/commit/00159e255015b519d741c6528a6c9ed3a586dc25))

## [0.16.2](https://github.com/kapetacom/local-cluster-service/compare/v0.16.1...v0.16.2) (2023-08-12)


### Bug Fixes

* Be smarter about caching ([086ffe4](https://github.com/kapetacom/local-cluster-service/commit/086ffe416a044a8d9dc5e33aa879960d3e3c2b1a))

## [0.16.1](https://github.com/kapetacom/local-cluster-service/compare/v0.16.0...v0.16.1) (2023-08-11)


### Bug Fixes

* Instead of ignoring we set source-of-change ([ecd23c4](https://github.com/kapetacom/local-cluster-service/commit/ecd23c4c3316a189038a1f2f2f2c8794f6153261))

# [0.16.0](https://github.com/kapetacom/local-cluster-service/compare/v0.15.3...v0.16.0) (2023-08-11)


### Features

* Use chokidar lib for watching for changes on disk ([#60](https://github.com/kapetacom/local-cluster-service/issues/60)) ([f2af855](https://github.com/kapetacom/local-cluster-service/commit/f2af85554fc2a23133ce27a4f8989cabdea097d7))

## [0.15.3](https://github.com/kapetacom/local-cluster-service/compare/v0.15.2...v0.15.3) (2023-08-10)


### Bug Fixes

* Use fresh API every time ([05851db](https://github.com/kapetacom/local-cluster-service/commit/05851dbf8c2a690c790a2ba93b7c0a8d24a93b06))

## [0.15.2](https://github.com/kapetacom/local-cluster-service/compare/v0.15.1...v0.15.2) (2023-08-09)


### Bug Fixes

* Emit events for default providers ([8308eea](https://github.com/kapetacom/local-cluster-service/commit/8308eeab0a1bbaf64c3c448d0b645a86dc8f8f9a))

## [0.15.1](https://github.com/kapetacom/local-cluster-service/compare/v0.15.0...v0.15.1) (2023-08-09)


### Bug Fixes

* Move providers into TS file - compile doesnt copy json ([1e2681a](https://github.com/kapetacom/local-cluster-service/commit/1e2681ab85592366e6eb99aab72a514b4a1503c4))

# [0.15.0](https://github.com/kapetacom/local-cluster-service/compare/v0.14.4...v0.15.0) (2023-08-09)


### Features

* auto-install core providers and cli when starting ([6495dce](https://github.com/kapetacom/local-cluster-service/commit/6495dcea33218fb214ee9df682ef327b91ebf817))

## [0.14.4](https://github.com/kapetacom/local-cluster-service/compare/v0.14.3...v0.14.4) (2023-08-09)


### Bug Fixes

* Handle missing authentication gracefully ([329d091](https://github.com/kapetacom/local-cluster-service/commit/329d09148261da3c624defcc252f2f700b3b4dc2))

## [0.14.3](https://github.com/kapetacom/local-cluster-service/compare/v0.14.2...v0.14.3) (2023-08-08)


### Bug Fixes

* Improve cross platform handling of child processes ([c2483f7](https://github.com/kapetacom/local-cluster-service/commit/c2483f78378fe5d6c379eb49ac12d1bf487181ad))

## [0.14.2](https://github.com/kapetacom/local-cluster-service/compare/v0.14.1...v0.14.2) (2023-08-08)


### Bug Fixes

* Use kapeta std lib for child process ([#58](https://github.com/kapetacom/local-cluster-service/issues/58)) ([43254ce](https://github.com/kapetacom/local-cluster-service/commit/43254cef67c86f8260150073d44b5803cd20e527))

## [0.14.1](https://github.com/kapetacom/local-cluster-service/compare/v0.14.0...v0.14.1) (2023-08-07)


### Bug Fixes

* Generate code in the background ([#57](https://github.com/kapetacom/local-cluster-service/issues/57)) ([2e14827](https://github.com/kapetacom/local-cluster-service/commit/2e1482713ee52a19aed8edb9810107f1f340537c))

# [0.14.0](https://github.com/kapetacom/local-cluster-service/compare/v0.13.0...v0.14.0) (2023-08-05)


### Features

* Added api proxy for remote services ([#56](https://github.com/kapetacom/local-cluster-service/issues/56)) ([ea2cba8](https://github.com/kapetacom/local-cluster-service/commit/ea2cba8936b422e4b17197c35ef656b501b740a5))

# [0.13.0](https://github.com/kapetacom/local-cluster-service/compare/v0.12.1...v0.13.0) (2023-08-03)


### Features

* Adds background task concept ([#55](https://github.com/kapetacom/local-cluster-service/issues/55)) ([71cc63c](https://github.com/kapetacom/local-cluster-service/commit/71cc63c9c3eb8bec1dec8b31d3340694e93bd3e5))

## [0.12.1](https://github.com/kapetacom/local-cluster-service/compare/v0.12.0...v0.12.1) (2023-08-02)


### Bug Fixes

* Adjustments to make starting plans locally smoother ([fc353ad](https://github.com/kapetacom/local-cluster-service/commit/fc353adde350b7e9d4c7eb9347c4cfa0c3a6aa58))

# [0.12.0](https://github.com/kapetacom/local-cluster-service/compare/v0.11.1...v0.12.0) (2023-07-31)


### Features

* Send status events to client when pulling image ([#54](https://github.com/kapetacom/local-cluster-service/issues/54)) ([6c6f1b0](https://github.com/kapetacom/local-cluster-service/commit/6c6f1b0cf31d4bbd1fccf10f4a66a3ac97ff7171))

## [0.11.1](https://github.com/kapetacom/local-cluster-service/compare/v0.11.0...v0.11.1) (2023-07-31)


### Bug Fixes

* Ensure we do not attempt to start / stop the same instance at the ([493e077](https://github.com/kapetacom/local-cluster-service/commit/493e077d0c6acdbcc371dae2ef8b6fbf2478c950))

# [0.11.0](https://github.com/kapetacom/local-cluster-service/compare/v0.10.1...v0.11.0) (2023-07-31)


### Features

* Always get logs from docker ([#53](https://github.com/kapetacom/local-cluster-service/issues/53)) ([5cab8cb](https://github.com/kapetacom/local-cluster-service/commit/5cab8cbf18b38edf99d538e1819e135f0a5bd7e3))

## [0.10.1](https://github.com/kapetacom/local-cluster-service/compare/v0.10.0...v0.10.1) (2023-07-27)


### Bug Fixes

* Include port bindings for non-local containers ([#51](https://github.com/kapetacom/local-cluster-service/issues/51)) ([64fd440](https://github.com/kapetacom/local-cluster-service/commit/64fd4409ea9e2dda8e2438d0ec85a8f5a2092b1e))

# [0.10.0](https://github.com/kapetacom/local-cluster-service/compare/v0.9.1...v0.10.0) (2023-07-26)


### Features

* Auto-reuse containers ([#50](https://github.com/kapetacom/local-cluster-service/issues/50)) ([ecb396b](https://github.com/kapetacom/local-cluster-service/commit/ecb396b541f9184302e0681f4803d2404336138e))

## [0.9.1](https://github.com/kapetacom/local-cluster-service/compare/v0.9.0...v0.9.1) (2023-07-26)


### Bug Fixes

* Rename containers before deleting to avoid name conflicts ([#49](https://github.com/kapetacom/local-cluster-service/issues/49)) ([ac977f0](https://github.com/kapetacom/local-cluster-service/commit/ac977f0a9f18f57a517342d51e4c1e1fee68e4ff))

# [0.9.0](https://github.com/kapetacom/local-cluster-service/compare/v0.8.3...v0.9.0) (2023-07-24)


### Features

* Improves stability and consistency when starting blocks ([#48](https://github.com/kapetacom/local-cluster-service/issues/48)) ([87afeba](https://github.com/kapetacom/local-cluster-service/commit/87afebaa87f054865519186df61c6f51f1c2c5f0))

## [0.8.3](https://github.com/kapetacom/local-cluster-service/compare/v0.8.2...v0.8.3) (2023-07-23)


### Bug Fixes

* Format ([736158b](https://github.com/kapetacom/local-cluster-service/commit/736158b8685aa2ac1193cdabbbb34d81f6d2e302))

## [0.8.2](https://github.com/kapetacom/local-cluster-service/compare/v0.8.1...v0.8.2) (2023-07-23)


### Bug Fixes

* Check for existing cluster services on the same point and exit if it exists ([#47](https://github.com/kapetacom/local-cluster-service/issues/47)) ([3c76c3c](https://github.com/kapetacom/local-cluster-service/commit/3c76c3c24927212e4a06dc627e6c7262b2c60c4f))

## [0.8.1](https://github.com/kapetacom/local-cluster-service/compare/v0.8.0...v0.8.1) (2023-07-22)


### Bug Fixes

* Removed debug ([e002caa](https://github.com/kapetacom/local-cluster-service/commit/e002caa3ae20c5a9a7f521e6e47bf46abfcb9e96))

# [0.8.0](https://github.com/kapetacom/local-cluster-service/compare/v0.7.6...v0.8.0) (2023-07-22)


### Features

* Added route for uploading attachments to assets ([#46](https://github.com/kapetacom/local-cluster-service/issues/46)) ([e668f33](https://github.com/kapetacom/local-cluster-service/commit/e668f33072e772077a3186fc753e8c516e15171d))

## [0.7.6](https://github.com/kapetacom/local-cluster-service/compare/v0.7.5...v0.7.6) (2023-07-17)


### Bug Fixes

* Adjustments to make docker interaction work on Linux ([#45](https://github.com/kapetacom/local-cluster-service/issues/45)) ([4c9530c](https://github.com/kapetacom/local-cluster-service/commit/4c9530c1a509c490e95cc16029202650f79e127e))

## [0.7.5](https://github.com/kapetacom/local-cluster-service/compare/v0.7.4...v0.7.5) (2023-07-17)


### Bug Fixes

* Handle homedir on windows ([913fdd4](https://github.com/kapetacom/local-cluster-service/commit/913fdd4f853e4f79848c06afe2aaed72792e9ec5))

## [0.7.4](https://github.com/kapetacom/local-cluster-service/compare/v0.7.3...v0.7.4) (2023-07-17)


### Bug Fixes

* Add host.docker.internal on Linux ([#43](https://github.com/kapetacom/local-cluster-service/issues/43)) ([f76eab1](https://github.com/kapetacom/local-cluster-service/commit/f76eab13059bc920026769303b49cf065d48f5ca))

## [0.7.3](https://github.com/kapetacom/local-cluster-service/compare/v0.7.2...v0.7.3) (2023-07-17)


### Bug Fixes

* Handle windows paths ([45eedcb](https://github.com/kapetacom/local-cluster-service/commit/45eedcb4b95a1d403d88dd63d74fa98b2c949559))

## [0.7.2](https://github.com/kapetacom/local-cluster-service/compare/v0.7.1...v0.7.2) (2023-07-16)


### Bug Fixes

* Removed missed module.exports from TS module ([d6d85af](https://github.com/kapetacom/local-cluster-service/commit/d6d85af4823960baa52d3a87243d2639dd4cdab4))

## [0.7.1](https://github.com/kapetacom/local-cluster-service/compare/v0.7.0...v0.7.1) (2023-07-16)


### Bug Fixes

* Do null check - filename sometimes is blank on win ([#41](https://github.com/kapetacom/local-cluster-service/issues/41)) ([5b4929f](https://github.com/kapetacom/local-cluster-service/commit/5b4929fb1fd6c209246fd7b5be6788eb0c1ae0c0))

# [0.7.0](https://github.com/kapetacom/local-cluster-service/compare/v0.6.1...v0.7.0) (2023-07-16)


### Features

* Rewrote service to Typescript ([#40](https://github.com/kapetacom/local-cluster-service/issues/40)) ([e9ead38](https://github.com/kapetacom/local-cluster-service/commit/e9ead38422e648cd270e32e93d240fb9a807c723))

## [0.6.1](https://github.com/kapetacom/local-cluster-service/compare/v0.6.0...v0.6.1) (2023-06-21)


### Bug Fixes

* Automaticly restart instances when changing configuration ([#39](https://github.com/kapetacom/local-cluster-service/issues/39)) ([9f6706f](https://github.com/kapetacom/local-cluster-service/commit/9f6706f7df9fb1c7375754bc81c56ccca93bbe12))

# [0.6.0](https://github.com/kapetacom/local-cluster-service/compare/v0.5.12...v0.6.0) (2023-06-21)


### Features

* Implemented endpoints for getting public addresses ([#38](https://github.com/kapetacom/local-cluster-service/issues/38)) ([2eb96a9](https://github.com/kapetacom/local-cluster-service/commit/2eb96a97761f426e8a5aadab8703ce44f059f618))

## [0.5.12](https://github.com/kapetacom/local-cluster-service/compare/v0.5.11...v0.5.12) (2023-06-21)


### Bug Fixes

* await asset deletion and only cache successful web requests ([663a4a7](https://github.com/kapetacom/local-cluster-service/commit/663a4a7987385f9a0550d6149a23b7a9de08b226))

## [0.5.11](https://github.com/kapetacom/local-cluster-service/compare/v0.5.10...v0.5.11) (2023-06-20)


### Bug Fixes

* Improve path template parser. ([#36](https://github.com/kapetacom/local-cluster-service/issues/36)) ([b655da1](https://github.com/kapetacom/local-cluster-service/commit/b655da1e97740ff2b4fe0f2bcd7f75b04003753e))

## [0.5.10](https://github.com/kapetacom/local-cluster-service/compare/v0.5.9...v0.5.10) (2023-06-19)


### Bug Fixes

* delete asset via ref ([6b5a968](https://github.com/kapetacom/local-cluster-service/commit/6b5a968a029753baea3a651a0538468086cda665))

## [0.5.9](https://github.com/kapetacom/local-cluster-service/compare/v0.5.8...v0.5.9) (2023-06-18)


### Bug Fixes

* Resolves various issues when proxiying HTTP requests ([#34](https://github.com/kapetacom/local-cluster-service/issues/34)) ([cb9a472](https://github.com/kapetacom/local-cluster-service/commit/cb9a472e560412a85cea20a1dc9083826797ac95))

## [0.5.8](https://github.com/kapetacom/local-cluster-service/compare/v0.5.7...v0.5.8) (2023-06-18)


### Bug Fixes

* Gracefully handle invalid targets ([#33](https://github.com/kapetacom/local-cluster-service/issues/33)) ([d36f58e](https://github.com/kapetacom/local-cluster-service/commit/d36f58e0e7486c36e7ce4fa6ea58fb17b683511e))

## [0.5.7](https://github.com/kapetacom/local-cluster-service/compare/v0.5.6...v0.5.7) (2023-06-17)


### Bug Fixes

* Register non-docker processes correctly ([#32](https://github.com/kapetacom/local-cluster-service/issues/32)) ([a6e1693](https://github.com/kapetacom/local-cluster-service/commit/a6e1693c32df233f1a16dd406ac0008f07fb3a1d))

## [0.5.6](https://github.com/kapetacom/local-cluster-service/compare/v0.5.5...v0.5.6) (2023-06-17)


### Bug Fixes

* Resolve operator versions from resources ([#31](https://github.com/kapetacom/local-cluster-service/issues/31)) ([dfd6471](https://github.com/kapetacom/local-cluster-service/commit/dfd647118ffdb5544d87743543152efd124d3310))

## [0.5.5](https://github.com/kapetacom/local-cluster-service/compare/v0.5.4...v0.5.5) (2023-06-16)


### Bug Fixes

* missed a few imports for cluster config ([6f2a491](https://github.com/kapetacom/local-cluster-service/commit/6f2a4919e2d100d2ae20a346d202eb2477282077))

## [0.5.4](https://github.com/kapetacom/local-cluster-service/compare/v0.5.3...v0.5.4) (2023-06-16)


### Bug Fixes

* handle ESM version of local-cluster-config ([08cd97e](https://github.com/kapetacom/local-cluster-service/commit/08cd97e4fa04d666105809b92c267953cf3d646b))

## [0.5.3](https://github.com/kapetacom/local-cluster-service/compare/v0.5.2...v0.5.3) (2023-06-09)


### Bug Fixes

* Make sure bound ports are exposed and ([#29](https://github.com/kapetacom/local-cluster-service/issues/29)) ([fe088b4](https://github.com/kapetacom/local-cluster-service/commit/fe088b424fa159ca1d04e721ace4558a778c5dcd))

## [0.5.2](https://github.com/kapetacom/local-cluster-service/compare/v0.5.1...v0.5.2) (2023-06-06)


### Bug Fixes

* Use internal docker host when inside docker ([#28](https://github.com/kapetacom/local-cluster-service/issues/28)) ([3b0ae9d](https://github.com/kapetacom/local-cluster-service/commit/3b0ae9d7612ae54b38ec8e39f632932f8543206e))

## [0.5.1](https://github.com/kapetacom/local-cluster-service/compare/v0.5.0...v0.5.1) (2023-06-06)


### Bug Fixes

* Improve starting and stopping local instances ([#27](https://github.com/kapetacom/local-cluster-service/issues/27)) ([83ff53a](https://github.com/kapetacom/local-cluster-service/commit/83ff53a31e98aa8984ff6a9a1e80ddb94653ce18))

# [0.5.0](https://github.com/kapetacom/local-cluster-service/compare/v0.4.1...v0.5.0) (2023-06-02)


### Features

* Bump deps to fix features ([d272d50](https://github.com/kapetacom/local-cluster-service/commit/d272d50e99efe6f0fc416266587a35e81aa474d1))

## [0.4.1](https://github.com/kapetacom/local-cluster-service/compare/v0.4.0...v0.4.1) (2023-06-02)


### Bug Fixes

* Variable reference was invalid ([#26](https://github.com/kapetacom/local-cluster-service/issues/26)) ([28ebb9b](https://github.com/kapetacom/local-cluster-service/commit/28ebb9b3c4d4099978fc1b5b4ca9cebfd148a941))

# [0.4.0](https://github.com/kapetacom/local-cluster-service/compare/v0.3.0...v0.4.0) (2023-06-01)


### Features

* Change to always run local code in docker container ([#25](https://github.com/kapetacom/local-cluster-service/issues/25)) ([6e4021e](https://github.com/kapetacom/local-cluster-service/commit/6e4021e67968467555f1043f2972fc7a877aa3b7))

# [0.3.0](https://github.com/kapetacom/local-cluster-service/compare/v0.2.1...v0.3.0) (2023-05-08)


### Features

* load docker config from clusterConfig if available [KAP-609] ([1ced2c1](https://github.com/kapetacom/local-cluster-service/commit/1ced2c1ed2f72bf3331e558ee2c685385c89ab1f))

## [0.2.1](https://github.com/kapetacom/local-cluster-service/compare/v0.2.0...v0.2.1) (2023-05-07)


### Bug Fixes

* Missing semantic ([7173501](https://github.com/kapetacom/local-cluster-service/commit/7173501faf2a15caa373ef2f89c6e718deaa06f1))

# [0.2.0](https://github.com/kapetacom/local-cluster-service/compare/v0.1.2...v0.2.0) (2023-05-07)


### Features

* Add support for health checks and mounts ([cac607b](https://github.com/kapetacom/local-cluster-service/commit/cac607bc8b592e27c8b6c2ff09476f90b2e4c3f3))

## [0.1.2](https://github.com/kapetacom/local-cluster-service/compare/v0.1.1...v0.1.2) (2023-05-06)


### Bug Fixes

* Moved all docker init things into init - and rely on that ([9a012c3](https://github.com/kapetacom/local-cluster-service/commit/9a012c3a40a6b4e4ef55757a4b8454d48bd3987c))

## [0.1.1](https://github.com/kapetacom/local-cluster-service/compare/v0.1.0...v0.1.1) (2023-05-06)


### Bug Fixes

* Add missing import ([54a570c](https://github.com/kapetacom/local-cluster-service/commit/54a570c8c0746ae014fbf9411c85dbf255bf8cea))

# [0.1.0](https://github.com/kapetacom/local-cluster-service/compare/v0.0.76...v0.1.0) (2023-05-06)


### Features

* Allow running docker block operators ([0a3992c](https://github.com/kapetacom/local-cluster-service/commit/0a3992c359a119a623ed7d0423e6f7ad814aa8d3))

## [0.0.76](https://github.com/kapetacom/local-cluster-service/compare/v0.0.75...v0.0.76) (2023-05-06)


### Bug Fixes

* include docker status in cluster startup response ([0d40253](https://github.com/kapetacom/local-cluster-service/commit/0d402535b7b936fa4f4f480147d8f3103249a6f8))
* make docker config try more variations before giving up ([f55629e](https://github.com/kapetacom/local-cluster-service/commit/f55629ed3f7167ec7b6810ec16ae6d8068722863))
