/**
 * Boot sequence: open the database, load caches (settings, clock, currency
 * registry overrides, FX anchors, service states), forge the demo world on
 * first run, restore the session and start the scheduler.
 */
import { db, getMeta, openDatabase } from './db/db';
import { clock } from './clock';
import { currencies } from './currency/registry';
import { loadAnchors } from './currency/rates';
import { DEFAULT_SETTINGS, setSettingsCache, type BankSettings } from './settings';
import { loadServiceCache } from './ops/system';
import { seedDemo, type SeedProgress } from './seed/seed';
import { decodeSnapshot, importSnapshot } from './seed/snapshot';
import { syslog } from './ops/audit';
import { restoreSession } from './security/auth';
import { startScheduler } from './ops/scheduler';
import { wipeData } from './ops/backup';
import type { User } from './types';

export interface BootResult {
  persistent: boolean;
  user: User | null;
  seededNow: boolean;
}

export async function loadCaches() {
  setSettingsCache(await getMeta<BankSettings>('settings', DEFAULT_SETTINGS));
  clock.setOffset(await getMeta<number>('clockOffset', 0));
  currencies.applyOverrides(await db.currencyOverrides.toArray());
  loadAnchors(await db.rates.toArray());
  await loadServiceCache();
}

export async function isSeeded() {
  return !!(await getMeta('seeded', null));
}

export async function boot(progress?: SeedProgress, opts: { scheduler?: boolean } = {}): Promise<BootResult> {
  const { persistent } = await openDatabase();
  await loadCaches();
  let seededNow = false;
  if (!(await isSeeded())) {
    await installDemoWorld(progress);
    seededNow = true;
    await loadCaches();
  }
  const user = await restoreSession();
  if (opts.scheduler !== false) startScheduler();
  return { persistent, user, seededNow };
}

/**
 * Install the demo world: import the pre-forged snapshot (fast), or — when
 * `live` is requested or the snapshot is unavailable — forge it right here in
 * the browser by running every historical operation through the services.
 */
export async function installDemoWorld(progress: SeedProgress = () => {}, live = false) {
  if (!live) {
    try {
      progress(5, 'seed.unpack');
      const mod = await import('../data/demoWorld');
      const snap = await decodeSnapshot(mod.default);
      await importSnapshot(snap, progress);
      await syslog('info', 'seed', `Demo world installed from snapshot (anchor ${snap.anchorDay})`);
      return;
    } catch (e) {
      await syslog('warn', 'seed', `Snapshot unavailable, forging live: ${e instanceof Error ? e.message : e}`);
      await wipeData();
    }
  }
  await seedDemo(progress);
}

/** Factory reset of the local demo (the audit trail is preserved). */
export async function resetDemo(progress?: SeedProgress, live = false) {
  await wipeData();
  await installDemoWorld(progress, live);
  await loadCaches();
}
