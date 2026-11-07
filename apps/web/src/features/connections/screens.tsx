import { Landmark } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ScreenStub } from '../../app/ScreenStub';
import { emptyStates } from '../../i18n/pt-BR';
import { EmptyState } from '../../ui';

/** I01: as conexões chegam na S3 (T-076); por enquanto, o estado vazio da UX §6.5 com as duas saídas. */
export function ConnectionsScreen() {
  const navigate = useNavigate();
  const state = emptyStates.connections;
  return (
    <>
      <ScreenStub screen="I01" />
      <EmptyState
        icon={Landmark}
        title={state.title}
        description={state.text}
        primaryAction={{
          label: state.actions[0],
          onPress: () => void navigate('/ajustes/conexoes/novo'),
        }}
        secondaryAction={{ label: state.actions[1], onPress: () => void navigate('/importar') }}
        data-testid="connections-empty"
      />
    </>
  );
}

export function ConnectBankScreen() {
  return <ScreenStub screen="I02" />;
}
