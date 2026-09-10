// The `@gnomon/storage/testing` subpath (Phase 3 gap G3): the test doubles
// other packages build on. The app's unit tests and its Playwright bridge
// import from here instead of reaching into this folder by relative path.
// Node-only (fixture.ts reads the reference brain from disk); never imported
// by src/.
export { FakeGitHub } from './fake-github';
export { FIXTURE, readBrainBytes } from './fixture';
