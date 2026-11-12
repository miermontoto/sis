<script lang="ts">
  // el contenido de un widget dentro de su card: despacha al componente de su
  // tipo. Lo comparten el slot de la rejilla y la vista previa de la galería
  import { WIDGET_COMPONENTS } from './components';
  import type { WidgetSettings, WidgetSize } from './registry';

  let { type, size, settings, onsettings }: {
    type: string;
    size: WidgetSize;
    settings: WidgetSettings;
    onsettings?: (patch: Partial<WidgetSettings>) => void;
  } = $props();

  let Comp = $derived(WIDGET_COMPONENTS[type]);
</script>

<div class="widget-body" data-size={size}>
  {#if Comp}<Comp {size} {settings} {onsettings} />{/if}
</div>
