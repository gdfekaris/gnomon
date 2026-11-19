// loadSnapshot: the one way the app and the CLI turn a driver into a
// BrainSnapshot (spec §4, §6.1). list, then read every frontmatter-bearing
// file in one readMany (drivers batch internally), then buildSnapshot.

import { type BrainSnapshot, buildSnapshot, isFrontmatterPath } from '@gnomon/core';
import type { StorageDriver } from './driver';

export async function loadSnapshot(driver: StorageDriver): Promise<BrainSnapshot> {
  const { head, tree } = driver.listAt ? await driver.listAt() : { head: await driver.head(), tree: await driver.list() };
  const texts = await driver.readMany(tree.map((e) => e.path).filter(isFrontmatterPath));
  return buildSnapshot({ head, tree, texts });
}
