<script lang="ts">
  // formulario de ajustes de un widget, armado desde los campos de su registro:
  // ningún widget trae UI de ajustes propia. Las opciones son .range-btn, el
  // mismo pill de los selectores de la app; el número, un input corto
  import { widgetDef, type SettingField, type WidgetSettings, type WidgetSettingValue } from './registry';

  let { type, settings, onchange }: {
    type: string;
    settings: WidgetSettings;
    onchange: (patch: Partial<WidgetSettings>) => void;
  } = $props();

  let fields = $derived((widgetDef(type)?.fields ?? []).filter(f => !f.showIf || f.showIf(settings)));

  const set = (key: string, value: WidgetSettingValue) => onchange({ [key]: value });

  // una cifra de un multi se quita o se pone conservando el orden del registro;
  // nunca se queda vacío (un widget de cifras sin cifras no enseña nada)
  function toggleMulti(f: Extract<SettingField, { kind: 'multi' }>, value: string) {
    const current = (settings[f.key] as string[]) ?? [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    if (next.length === 0) return;
    set(f.key, f.options.map(o => o.value).filter(v => next.includes(v)));
  }

  function commitNumber(f: Extract<SettingField, { kind: 'number' }>, input: HTMLInputElement) {
    const n = Number(input.value);
    if (Number.isFinite(n) && n >= f.min && n <= f.max) set(f.key, n);
    else input.value = String(settings[f.key]);
  }
</script>

{#if fields.length === 0}
  <p class="wsf-empty">This widget has no settings.</p>
{:else}
  <div class="wsf">
    {#each fields as f (f.key)}
      <div class="wsf-row">
        <span class="wsf-label">{f.label}</span>
        <div class="wsf-control">
          {#if f.kind === 'select'}
            {#each f.options as o (o.value)}
              <button type="button" class="range-btn" class:active={settings[f.key] === o.value} onclick={() => set(f.key, o.value)}>{o.label}</button>
            {/each}
          {:else if f.kind === 'multi'}
            {#each f.options as o (o.value)}
              {@const on = (settings[f.key] as string[]).includes(o.value)}
              <button type="button" class="range-btn" class:active={on} aria-pressed={on} onclick={() => toggleMulti(f, o.value)}>{o.label}</button>
            {/each}
          {:else if f.kind === 'toggle'}
            <button type="button" class="range-btn" class:active={settings[f.key] === true} aria-pressed={settings[f.key] === true} onclick={() => set(f.key, !settings[f.key])}>
              {settings[f.key] ? 'On' : 'Off'}
            </button>
          {:else if f.kind === 'number'}
            <input
              class="wsf-number"
              type="number"
              inputmode="numeric"
              min={f.min}
              max={f.max}
              step={f.step}
              value={settings[f.key]}
              aria-label={f.label}
              onchange={(e) => commitNumber(f, e.currentTarget)}
            />
            {#if f.unit}<span class="wsf-unit">{f.unit}</span>{/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .wsf {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .wsf-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .wsf-label {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--track-wide);
    color: var(--text-muted);
  }
  .wsf-control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .wsf-number {
    width: 7rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    padding: 0.35rem 0.5rem;
  }
  .wsf-unit {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .wsf-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  /* el suelo de 16px de @platform/ui en táctil: con una clase propia el input
     volvería a hacer zoom al enfocarse en ios (ver CLAUDE.md, base.css) */
  @media (hover: none) {
    .wsf-number { font-size: var(--fs-input-touch); }
  }
</style>
