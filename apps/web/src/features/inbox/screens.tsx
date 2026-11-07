import { CheckCircle } from 'lucide-react';
import { ScreenStub } from '../../app/ScreenStub';
import { emptyStates } from '../../i18n/pt-BR';
import { EmptyState } from '../../ui';

/** I05: a conferência chega com o conciliador (T-079); sem importados, o estado vazio da UX §6.5. */
export function InboxScreen() {
  return (
    <>
      <ScreenStub screen="I05" />
      <EmptyState
        variant="done"
        icon={CheckCircle}
        title={emptyStates.inbox.title}
        description={emptyStates.inbox.text}
        data-testid="inbox-empty"
      />
    </>
  );
}
