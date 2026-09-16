// Which sets (and the reserve) are open on the Sets screen: remembered for the session, not the device,
// so a trip into a principle and back finds the same sets open, and a relaunch starts collapsed.
export const setsView = $state<{ open: string[] }>({ open: [] });
