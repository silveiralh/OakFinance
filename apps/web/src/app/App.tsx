import { t } from '../i18n/pt-BR';

// Casca provisória: rotas, layout e guarda de auth chegam na T-029.
export function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('onb.welcome.title')}</h1>
      <p className="text-base">{t('onb.welcome.subtitle')}</p>
    </main>
  );
}
