import { useEffect, useState } from 'react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { Sheet } from '../../components/modals/Sheet';
import { streakInfo } from '../../core/progress/progress-engine';
import type { StringKey } from '../../core/localization/ui-strings';
import { track } from '../../services/v3/v3-client';
import { buildShareText } from '../../utils/share';
import { useProfile } from '../profile/profile-store';
import { nfmt, v3 } from '../v3/strings';
import { renderCard, shareLinkFor } from './share-card';

/** Preview of the result card with share / download / copy. */
export default function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useApp((s) => s.session);
  const speed = useApp((s) => s.speed);
  const prefs = useApp((s) => s.prefs);
  const t = useApp((s) => s.t);
  const showToast = useApp((s) => s.showToast);
  const progress = useProfile((s) => s.progress);
  const lang = prefs.uiLang;
  const x = v3(lang);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const isSpeed = !!speed && (!session || session.mode === 'speed');
  const label = isSpeed
    ? x.speed
    : session?.mode === 'daily' || session?.mode === 'archive'
      ? t('daily.number', { n: session.dailyNumber ?? 1 })
      : session
        ? `${t(`mode.${session.mode}` as StringKey)}${session.topic ? ` · ${session.topic}` : ''}`
        : '';
  const link = shareLinkFor(session, speed);
  const text = isSpeed ? `WORDLY ⚡ ${nfmt(x.speedScore, { n: speed!.words.filter((w) => w.won).length }, lang)}\n\n${link}` : session ? buildShareText(session, prefs.highContrast, link) : link;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let objectUrl: string | null = null;
    renderCard({ session, speed, uiLang: lang, colorBlind: prefs.highContrast, label, streak: streakInfo(progress).count })
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
      setBlob(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const file = blob ? new File([blob], 'wordly.png', { type: 'image/png' }) : null;
  const canShareFile = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  const share = async () => {
    try {
      if (canShareFile) {
        await navigator.share({ files: [file!], text });
        showToast(x.shared, 'success');
      } else {
        download();
      }
      track('share', `${session?.mode ?? 'speed'}:image`);
    } catch {
      /* cancelled */
    }
  };
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wordly.png';
    a.click();
    showToast(x.saved, 'success');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(x.copied, 'success');
      track('share', `${session?.mode ?? 'speed'}:text`);
    } catch {
      showToast(x.err_offline, 'error');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label={x.shareTitle}>
      <h2 className="sheet__title">{x.shareTitle}</h2>
      <div className="share-card">
        {url ? <img src={url} alt={label} /> : <div className="share-card__ph" aria-busy="true" />}
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
        <Button variant="primary" block disabled={!blob} onClick={() => void share()}>
          {canShareFile ? x.shareImage : x.download}
        </Button>
        <Button block onClick={() => void copy()}>
          {x.copyText}
        </Button>
      </div>
    </Sheet>
  );
}
