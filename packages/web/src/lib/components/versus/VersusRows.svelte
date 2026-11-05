<script lang="ts">
  import type { VersusRow } from '$lib/utils/artist-versus';

  // tabla de la comparación: una cifra por lado con su etiqueta en medio. La cifra que gana
  // va en el verde de todas las cifras de la app y la otra se apaga; el color de identidad
  // sólo marca la columna, que el texto no lleva el color de la serie
  let { names, rows }: { names: [string, string]; rows: VersusRow[] } = $props();
</script>

<table class="vs-rows">
  <thead>
    <tr>
      <th scope="col" class="vs-head vs-head--a"><span class="versus-key versus-key--a"></span>{names[0]}</th>
      <th scope="col"><span class="sr-only">Stat</span></th>
      <th scope="col" class="vs-head vs-head--b">{names[1]}<span class="versus-key versus-key--b"></span></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.key)}
      <tr>
        <td class="vs-value vs-value--a" class:lead={row.leader === 'a'} class:trail={row.leader === 'b'}>{row.a}</td>
        <th scope="row" class="vs-label">{row.label}</th>
        <td class="vs-value vs-value--b" class:lead={row.leader === 'b'} class:trail={row.leader === 'a'}>{row.b}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .vs-rows {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .vs-head {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    padding-bottom: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vs-head--a {
    text-align: left;
  }
  .vs-head--a .versus-key {
    margin-right: 0.4rem;
  }
  .vs-head--b {
    text-align: right;
  }
  .vs-head--b .versus-key {
    margin-left: 0.4rem;
  }
  tbody tr + tr {
    border-top: 1px solid var(--border);
  }
  .vs-value {
    padding: 0.5rem 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-md);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .vs-value--a {
    text-align: left;
  }
  .vs-value--b {
    text-align: right;
  }
  .vs-value.lead {
    color: var(--accent);
    font-weight: 700;
  }
  .vs-value.trail {
    color: var(--text-muted);
  }
  .vs-label {
    padding: 0.5rem;
    width: 36%;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: var(--track);
    color: var(--text-muted);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
