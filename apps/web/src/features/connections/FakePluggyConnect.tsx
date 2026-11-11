// Só no build E2E (VITE_E2E=1, tech §8.4): troca o Pluggy Connect por um diálogo que devolve o item do mock
// (`window.__oakE2EPluggyItem`, definido pelo teste) ou fecha sem conectar.
import type { PluggyWidgetProps } from './PluggyWidget';

declare global {
  interface Window {
    __oakE2EPluggyItem?: string;
  }
}

export default function FakePluggyConnect(props: PluggyWidgetProps) {
  return (
    <div role="dialog" aria-label="Pluggy Connect (teste)" data-testid="fake-pluggy-connect">
      <p>Pluggy Connect (teste)</p>
      <button
        type="button"
        className="btn"
        onClick={() => props.onSuccess(window.__oakE2EPluggyItem ?? 'item-teste')}
      >
        Autorizar (teste)
      </button>
      <button type="button" className="btn" onClick={() => props.onClose()}>
        Fechar (teste)
      </button>
    </div>
  );
}
