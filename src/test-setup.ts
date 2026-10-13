// Global setup for unit tests (Vitest + jsdom), registered in angular.json → test.setupFiles.

// In-memory IndexedDB so DataService/TimerService run against a real Dexie database.
import 'fake-indexeddb/auto';

// Run every test in a time zone with daylight-saving time, so DST bugs surface
// on every machine (CI runners default to UTC, which has none).
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env['TZ'] = 'Europe/Zurich';
