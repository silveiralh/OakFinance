import { type ScreenId, shellText } from '../i18n/pt-BR';

export interface ScreenStubProps {
  screen: ScreenId;
  /** Fora do AppShell (onboarding) a própria tela traz o `<h1>`. */
  standalone?: boolean;
}

/**
 * Conteúdo provisório de uma tela que ainda não foi implementada: a rota, o título e o lazy-load já existem
 * (T-029); cada tarefa de tela troca este componente pelo conteúdo da UX §3.
 */
export function ScreenStub({ screen, standalone = false }: ScreenStubProps) {
  return (
    <section className="screen" data-screen={screen} data-testid={`screen-${screen}`}>
      {standalone && <h1 className="screen-title">{shellText.screens[screen]}</h1>}
    </section>
  );
}
