import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { Icon } from '../../components/layout/Icon';
import { Sheet } from '../../components/modals/Sheet';

/** Pause screen. While PAUSED the engine rejects all input, so the board is frozen. */
export function PauseSheet() {
  const status = useApp((s) => s.session?.status);
  const t = useApp((s) => s.t);
  const { resumeGame, quitGame, go } = useApp.getState();
  return (
    <Sheet open={status === 'PAUSED'} onClose={resumeGame} label={t('pause.title')}>
      <h2 className="sheet__title">{t('pause.title')}</h2>
      <div className="stack" style={{ marginTop: 16 }}>
        <Button variant="primary" block onClick={resumeGame}>
          <Icon name="play" /> {t('pause.resume')}
        </Button>
        <Button block onClick={() => go('howto')}>
          <Icon name="help" /> {t('pause.howto')}
        </Button>
        <Button variant="ghost" block onClick={quitGame}>
          {t('pause.quit')}
        </Button>
      </div>
    </Sheet>
  );
}
