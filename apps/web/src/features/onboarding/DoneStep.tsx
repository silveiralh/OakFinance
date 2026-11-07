// ON08 — Configuração concluída (UX §3 ON08, US-08): grava a conclusão (`completedAt`, o onboarding_concluido_em
// do PRD) e oferece o primeiro lançamento (Q01 sobre o Início) ou o Início.
import { CheckCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { t } from '../../i18n/pt-BR';
import { Button } from '../../ui';
import { finish, updateOnboarding } from './progress';

export function DoneStep() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      return;
    }
    void updateOnboarding(user.db, (s) => finish(s, new Date().toISOString())).then(() =>
      user.engine.notifyWrite(),
    );
  }, [user]);

  return (
    <section className="screen onb-step onb-done" data-screen="ON08" data-testid="screen-ON08">
      <span className="onb-icon" data-tone="success" aria-hidden="true">
        <CheckCircle size={32} />
      </span>
      <h1 className="screen-title">{t('onb.done.title')}</h1>
      <p>{t('onb.done.body')}</p>
      <footer className="onb-actions">
        <Button
          fullWidth
          onClick={() => void navigate('/?novo=despesa')}
          data-testid="onb-done-first"
        >
          {t('onb.done.cta')}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void navigate('/')}
          data-testid="onb-done-home"
        >
          {t('onb.done.home')}
        </Button>
      </footer>
    </section>
  );
}
