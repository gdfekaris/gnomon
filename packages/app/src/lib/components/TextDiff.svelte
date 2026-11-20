<script lang="ts">
  // A file as it stands beside the text that was sealed (spec §6.5): one text, with what is gone struck through and what is new underlined.
  import { diffText } from '../diff';
  let { was, now }: { was: string; now: string } = $props();
  const parts = $derived(diffText(was, now));
</script>

<pre class="diff" data-testid="text-diff">{#each parts as p, i (i)}{#if p.kind === 'same'}{p.text}{:else if p.kind === 'gone'}<del data-testid="diff-gone">{p.text}</del>{:else}<ins data-testid="diff-new">{p.text}</ins>{/if}{/each}</pre>

<style>
  .diff { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0; }
</style>
