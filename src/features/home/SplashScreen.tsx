import { motion } from 'motion/react';
import { useEffect } from 'react';
import { useApp } from '../../app/store';
import { Logo } from '../../components/layout/Logo';
import { wordEngine } from '../../core/words/word-engine';

export function SplashScreen() {
  const go = useApp((s) => s.go);
  const t = useApp((s) => s.t);
  const lang = useApp((s) => s.prefs.puzzleLang);
  const reduced = document.documentElement.dataset.motion === 'reduced';

  useEffect(() => {
    // warm the dictionary for the preferred language while the logo plays
    void wordEngine.load(lang).catch(() => undefined);
    const id = setTimeout(() => go('menu', { replace: true }), reduced ? 250 : 1500);
    return () => clearTimeout(id);
  }, [go, lang, reduced]);

  return (
    <button type="button" onClick={() => go('menu', { replace: true })} style={{ flex: 1, display: 'grid', placeItems: 'center' }} aria-label="WORDLY">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 18 }}>
        <Logo size={48} animate />
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.5 }} className="muted" style={{ margin: 0 }}>
          {t('app.tagline')}
        </motion.p>
      </div>
    </button>
  );
}
