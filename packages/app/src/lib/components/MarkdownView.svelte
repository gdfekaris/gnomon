<script lang="ts">
  import { renderMarkdown } from '../markdown';
  import { snapshot } from '../stores/snapshot.svelte';
  let { body, path, anchor = undefined }: { body: string; path: string; anchor?: string | undefined } = $props();
  const html = $derived(renderMarkdown(body, path, snapshot.current));
  let root = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!anchor || !root) return;
    void html;
    root.querySelector(`[id="${CSS.escape(anchor)}"]`)?.scrollIntoView();
  });
</script>

<div class="markdown" bind:this={root} data-testid="file-body">{@html html}</div>

<style>
  .markdown :global(pre) { overflow-x: auto; }
  .markdown :global(img) { max-width: 100%; }
  .markdown :global(blockquote) { border-left: 3px solid #d6d3d1; margin-left: 0; padding-left: 1rem; opacity: 0.9; }
</style>
