<script lang="ts">
  // The app's pixel icons: 16 px, 1 px strokes on half-pixel offsets, crisp
  // edges, drawn in currentColor so every skin and theme recolors them.
  export type IconName = 'capture' | 'browse' | 'inbox' | 'proposals' | 'sets' | 'reason' | 'settings' | 'hand' | 'check' | 'stop' | 'bang' | 'clock' | 'arrowl';
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
  const PATHS: Record<IconName, string> = {
    capture: '<rect x="3.5" y="2.5" width="9" height="12" class="s"/><rect x="6" y="1" width="4" height="3" class="f"/><path d="M6 7.5h4M6 9.5h4M6 11.5h3" class="s"/>',
    browse: '<path d="M1.5 4.5h5l2 2h6v7h-13z" class="s"/><path d="M1.5 7.5h13" class="s"/>',
    inbox: '<path d="M2.5 9.5v4h11v-4" class="s"/><path d="M2.5 9.5h3l1 2h3l1-2h3" class="s"/><path d="M8.5 1v6M6 5l2.5 2.5L11 5" class="s"/>',
    proposals: '<rect x="3.5" y="1.5" width="9" height="13" class="s"/><path d="M5.5 8.5l2 2 3.5-3.5" class="s"/>',
    sets: '<rect x="1" y="2" width="3" height="3" class="f"/><rect x="1" y="7" width="3" height="3" class="f"/><rect x="1" y="12" width="3" height="3" class="f"/><path d="M6 3.5h9M6 8.5h9M6 13.5h9" class="s"/>',
    reason: '<rect x="1.5" y="2.5" width="13" height="9" class="s"/><path d="M4.5 11.5v3l3-3" class="s"/><path d="M4 5.5h8M4 8.5h5" class="s"/>',
    settings: '<path d="M5.5 2v12M10.5 2v12" class="s"/><rect x="3" y="5" width="5" height="3" class="f"/><rect x="8" y="9" width="5" height="3" class="f"/>',
    hand: '<path d="M6.5 1.5h3v6h4v2l-4 5h-3l-4-5v-2h4z" class="s"/><path d="M8 4v4" class="s"/>',
    check: '<path d="M2.5 8.5l4 4 7-8" class="s" stroke-width="2"/>',
    stop: '<path d="M5 1.5h6l3.5 3.5v6L11 14.5H5L1.5 11V5z" class="s"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" class="s"/>',
    bang: '<rect x="1.5" y="1.5" width="13" height="13" class="s"/><path d="M8 4v5M8 11v1.5" class="s" stroke-width="2"/>',
    clock: '<rect x="1.5" y="1.5" width="13" height="13" class="s"/><path d="M8 4v4.5h3" class="s"/>',
    arrowl: '<path d="M14 8H3M7 4L3 8l4 4" class="s" stroke-width="2"/>',
  };
</script>

<svg width={size} height={size} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" class="icon">
  {@html PATHS[name]}
</svg>

<style>
  .icon { flex: none; display: inline-block; vertical-align: -3px; }
  .icon :global(.s) { fill: none; stroke: currentColor; stroke-width: 1; }
  .icon :global(.f) { fill: currentColor; }
</style>
