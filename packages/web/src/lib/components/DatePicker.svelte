<script lang="ts">
  // Único selector de fecha (y fecha+hora) de la app. Sustituye a los
  // <input type="date"> y "datetime-local" nativos, que se pintan en el locale
  // del navegador (el del sistema) e ignoran el ajuste `locale` que respeta todo
  // lo demás (formatShortDate, los meses de las gráficas…): con la app en
  // español y el sistema en inglés, la fecha salía "09/11/2026" y el calendario
  // arrancaba en domingo. El valor conserva el contrato de los inputs nativos
  // —'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm' en hora local, '' si vacío— para que el
  // consumidor no note el cambio. El calendario es un popover fijo
  // (positionPopover 'below') porque los modales que lo usan tienen overflow.
  import { browser } from '$app/environment';
  import { getLocale } from '$lib/api';
  import { positionPopover } from '$lib/utils/popover';
  import {
    firstDayOfWeek, monthGrid, weekdayLabels, monthLabel, uses12HourClock, formatPickerValue,
    splitValue, joinValue, keyParts, shiftMonth, todayKey, nowLocalValue, timeParts, clampTime,
    to24Hour, to12Hour,
  } from '$lib/utils/calendar';

  interface Props {
    value?: string;
    onchange?: (value: string) => void;
    mode?: 'date' | 'datetime';
    /** 'YYYY-MM-DD' inclusive */
    min?: string;
    max?: string;
    placeholder?: string;
    /** botón × para vaciar el valor (filtros; un formulario obligatorio no lo lleva) */
    clearable?: boolean;
    disabled?: boolean;
    label?: string;
  }

  let {
    value = $bindable(''),
    onchange,
    mode = 'date',
    min = '',
    max = '',
    placeholder = 'Pick a date',
    clearable = false,
    disabled = false,
    label = 'Date',
  }: Props = $props();

  const MONTHS_PER_YEAR = 12;

  const locale = getLocale();
  const firstDay = firstDayOfWeek(locale);
  const dayNames = weekdayLabels(locale, firstDay);
  const today = todayKey();

  let withTime = $derived(mode === 'datetime');
  let hour12 = $derived(withTime && uses12HourClock(locale));
  let parts = $derived(splitValue(value));
  let text = $derived(formatPickerValue(value, locale, withTime));
  let clock = $derived(timeParts(parts.time));
  let clock12 = $derived(to12Hour(clock.hours));

  let open = $state(false);
  let viewYear = $state(0);
  let viewMonth = $state(0);
  let rootEl: HTMLElement | undefined = $state();

  let cells = $derived(monthGrid(viewYear, viewMonth, firstDay));
  let heading = $derived(monthLabel(viewYear, viewMonth, locale));

  function openPicker() {
    if (disabled) return;
    ({ year: viewYear, month: viewMonth } = keyParts(parts.date || today));
    open = true;
  }

  function commit(date: string, time: string) {
    value = joinValue(date, time, withTime);
    onchange?.(value);
  }

  function pickDay(key: string) {
    // sin hora previa, la de ahora: "lo escuché hoy" rara vez es a medianoche
    commit(key, parts.time || splitValue(nowLocalValue()).time);
    if (!withTime) open = false;
  }

  function clear() {
    commit('', '');
    open = false;
  }

  function move(months: number) {
    ({ year: viewYear, month: viewMonth } = shiftMonth(viewYear, viewMonth, months));
  }

  function setClock(hours: number, minutes: number) {
    commit(parts.date || today, clampTime(hours, minutes));
  }

  function onHourInput(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isNaN(v)) return;
    setClock(hour12 ? to24Hour(v, clock12.pm) : v, clock.minutes);
  }

  function onMinuteInput(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isNaN(v)) setClock(clock.hours, v);
  }

  function togglePm() {
    setClock(to24Hour(clock12.hour, !clock12.pm), clock.minutes);
  }

  const outOfRange = (key: string) => (min !== '' && key < min) || (max !== '' && key > max);

  function handleOutside(e: PointerEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false;
  }

  $effect(() => {
    if (!browser || !open) return;
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  });
</script>

<div class="dp" bind:this={rootEl}>
  <button
    type="button"
    class="dp-trigger"
    class:dp-trigger--empty={!text}
    class:dp-trigger--open={open}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={label}
    {disabled}
    onclick={() => (open ? (open = false) : openPicker())}
  >
    <svg class="dp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
    <span class="dp-text">{text || placeholder}</span>
  </button>
  {#if clearable && value && !disabled}
    <button type="button" class="dp-clear" aria-label="Clear date" onclick={clear}>×</button>
  {/if}

  {#if open}
    <div class="dp-pop" role="dialog" aria-label={label} use:positionPopover={'below'}>
      <div class="dp-nav">
        <button type="button" class="dp-nav-btn" aria-label="Previous year" onclick={() => move(-MONTHS_PER_YEAR)}>&laquo;</button>
        <button type="button" class="dp-nav-btn" aria-label="Previous month" onclick={() => move(-1)}>&lsaquo;</button>
        <span class="dp-heading">{heading}</span>
        <button type="button" class="dp-nav-btn" aria-label="Next month" onclick={() => move(1)}>&rsaquo;</button>
        <button type="button" class="dp-nav-btn" aria-label="Next year" onclick={() => move(MONTHS_PER_YEAR)}>&raquo;</button>
      </div>

      <div class="dp-grid" role="grid">
        {#each dayNames as name}
          <span class="dp-dow" role="columnheader">{name}</span>
        {/each}
        {#each cells as cell (cell.key)}
          <button
            type="button"
            class="dp-day"
            class:dp-day--out={!cell.inMonth}
            class:dp-day--today={cell.key === today}
            class:dp-day--selected={cell.key === parts.date}
            role="gridcell"
            aria-selected={cell.key === parts.date}
            disabled={outOfRange(cell.key)}
            onclick={() => pickDay(cell.key)}
          >
            {cell.day}
          </button>
        {/each}
      </div>

      {#if withTime}
        <div class="dp-time">
          <input
            type="number"
            class="dp-time-field"
            aria-label="Hour"
            min={hour12 ? 1 : 0}
            max={hour12 ? 12 : 23}
            value={hour12 ? clock12.hour : clock.hours}
            oninput={onHourInput}
          />
          <span class="dp-time-sep">:</span>
          <input
            type="number"
            class="dp-time-field"
            aria-label="Minute"
            min="0"
            max="59"
            value={String(clock.minutes).padStart(2, '0')}
            oninput={onMinuteInput}
          />
          {#if hour12}
            <button type="button" class="dp-ampm" onclick={togglePm}>{clock12.pm ? 'PM' : 'AM'}</button>
          {/if}
          <button type="button" class="dp-done" onclick={() => (open = false)}>Done</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .dp {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
  }

  .dp-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    transition: border-color 0.05s, color 0.05s;
  }
  .dp-trigger:hover,
  .dp-trigger--open,
  .dp-trigger:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .dp-trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .dp-trigger--empty .dp-text {
    color: var(--text-muted);
  }
  .dp-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .dp-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dp-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.3rem;
    cursor: pointer;
  }
  .dp-clear:hover {
    color: var(--text);
  }

  .dp-pop {
    position: fixed;
    z-index: 200;
    width: 17.5rem;
    max-width: calc(100vw - 16px);
    padding: 0.5rem;
    border-radius: var(--radius);
    background: var(--bg-card);
    border: 1px solid rgba(29, 185, 84, 0.25);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: dp-pop 0.14s ease-out;
    user-select: none;
  }
  @keyframes dp-pop {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dp-nav {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    margin-bottom: 0.4rem;
  }
  .dp-heading {
    flex: 1;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .dp-heading::first-letter {
    text-transform: uppercase;
  }
  .dp-nav-btn {
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .dp-nav-btn:hover {
    color: var(--text);
    border-color: var(--border);
  }

  .dp-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .dp-dow {
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: 0.15rem 0 0.3rem;
  }
  .dp-day {
    height: 30px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background 0.05s, border-color 0.05s;
  }
  .dp-day:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .dp-day--out {
    color: var(--text-muted);
    opacity: 0.55;
  }
  .dp-day--today {
    border-color: var(--border);
  }
  .dp-day--selected,
  .dp-day--selected:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .dp-day:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .dp-time {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .dp-time-field {
    width: 3.2rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: 0.3rem 0.2rem;
    outline: none;
  }
  .dp-time-field:focus {
    border-color: var(--accent);
  }
  .dp-time-sep {
    color: var(--text-muted);
  }
  .dp-ampm,
  .dp-done {
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
  }
  .dp-ampm:hover,
  .dp-done:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .dp-done {
    margin-left: auto;
    color: var(--accent);
  }
</style>
