import { HardDrives, Warning } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';
import { getStorageStatus, subscribeStorage } from '../data/storage';
import { shellText } from '../i18n/pt-BR';
import { Banner } from '../ui';

/** G11 (armazenamento cheio) e G12 (IndexedDB bloqueado): banners persistentes abaixo do topo (UX §3 G). */
export function StorageBanners() {
  const status = useSyncExternalStore(subscribeStorage, getStorageStatus, getStorageStatus);
  return (
    <div className="shell-banners">
      {status.mode === 'online-only' && (
        <Banner
          tone="warning"
          icon={Warning}
          message={shellText.storageBlocked}
          data-testid="g12"
        />
      )}
      {status.full && (
        <Banner
          tone="warning"
          icon={HardDrives}
          message={shellText.storageFull}
          data-testid="g11"
        />
      )}
    </div>
  );
}
