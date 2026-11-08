import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { levelInfo, streakInfo } from '../../core/progress/progress-engine';
import * as social from '../../services/social/social-client';
import { MiniFlame } from '../profile/Flame';
import { colorOf, useProfile } from '../profile/profile-store';
import { bootDuelLink, useDuel } from '../social/duel-store';
import { sfmt, sx } from '../social/i18n';
import { FloatingTiles } from './FloatingTiles';
import { hasSavedSession, useApp } from '../../app/store';
import { wordEngine } from '../../core/words/word-engine';
import { Button } from '../../components/buttons/Button';
import { Icon, type IconName } from '../../components/layout/Icon';
import { Logo } from '../../components/layout/Logo';
import { formatNumber, type StringKey } from '../../core/localization/ui-strings';
import { dailyStreak } from '../../core/statistics/statistics-engine';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import { activeSeason } from '../../core/season/season';
import { nfmt, v3 } from '../v3/strings';
import { openGroupLink } from '../league/group-link';
import type { Lang } from '../../types';

let linkBooted = false;

const RIYADH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' });
function todayRiyadh(): string {
  return RIYADH.format(new Date());
}

export function MenuScreen() {
  const { go, t, prefs, setPrefs, coins, results, resumeSaved } = useApp();
  const saved = useMemo(() => hasSavedSession('classic') ?? hasSavedSession('infinite') ?? hasSavedSession('custom'), []);
  const streak = dailyStreak(results, prefs.puzzleLang, todayRiyadh()).current;
  const lang = prefs.uiLang;

  const tiles: { icon: IconName; key: StringKey; to: 'stats' | 'achievements' | 'settings' | 'howto' }[] = [
    { icon: 'chart', key: 'menu.stats', to: 'stats' },
    { icon: 'trophy', key: 'menu.achievements', to: 'achievements' },
    { icon: 'gear', key: 'menu.settings', to: 'settings' },
    { icon: 'help', key: 'menu.howto', to: 'howto' },
  ];

  const switchLang = (l: Lang) => setPrefs({ uiLang: l, puzzleLang: l });
  const progress = useProfile((x) => x.progress);
  const identity = useProfile((x) => x.identity);
  const token = useProfile((x) => x.token);
  const li = levelInfo(progress.xp);
  const st = streakInfo(progress);
  const sxs = sx(lang);
  const [invite, setInvite] = useState<social.Invite | null>(null);

  // Warm the dictionary while the player looks at the menu, so "Play" opens the board instantly.
  const puzzleLang = prefs.puzzleLang;
  useEffect(() => {
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const warm = () => void wordEngine.load(puzzleLang).catch(() => undefined);
    const id = ric ? ric(warm, { timeout: 2500 }) : window.setTimeout(warm, 1200);
    return () => {
      const cic = (window as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(id);
      else clearTimeout(id);
    };
  }, [puzzleLang]);

  useEffect(() => {
    if (!linkBooted) {
      linkBooted = true;
      bootDuelLink();
      bootV3Links();
    }
  }, []);
  const season = useMemo(() => activeSeason(), []);
  const x = v3(lang);
  const speedBest = useApp((s) => s.speedRecord.best[prefs.puzzleLang]);
  const firstTime = !prefs.seenHowTo && results.length === 0;
  useEffect(() => {
    if (!token) return;
    let alive = true;
    social.friends(token).then((r) => alive && setInvite(r.invites[0] ?? null), () => undefined);
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <>
    <FloatingTiles />
    <motion.div variants={listVariants} initial="hidden" animate="show" style={{ position: 'relative', zIndex: 1,  display: 'flex', flexDirection: 'column', gap: 14, flex: 1, justifyContent: 'center', maxWidth: 440, width: '100%', margin: '0 auto' }}>
      <motion.div variants={itemVariants} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'absolute', top: 'max(env(safe-area-inset-top), 12px)', insetInline: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <motion.button className="me-chip" whileTap={{ scale: 0.92 }} onClick={() => go('profile')} aria-label={sxs.profile} style={{ ['--av' as string]: colorOf(identity.color) }}>
            <span className="me-chip__av">{identity.avatar}</span>
            <span className="me-chip__lvl">{formatNumber(li.level, lang)}</span>
            <span className="me-chip__bar">
              <motion.i style={{ transformOrigin: lang === 'ar' ? '100% 50%' : '0% 50%' }} initial={{ scaleX: 0 }} animate={{ scaleX: li.pct }} transition={{ duration: 1, delay: 0.4 }} />
            </span>
          </motion.button>
          <motion.button className={`pill streak-pill${st.count ? ' is-lit' : ''}${st.atRisk ? ' is-risk' : ''}`} whileTap={{ scale: 0.92 }} onClick={() => go('profile')} aria-label={sxs.streak}>
            <MiniFlame count={st.count} difficulty={st.difficulty} size={14} /> {formatNumber(st.count, lang)}
          </motion.button>
          <span className="pill" aria-label={`${coins} ${t('menu.coins')}`}>
            <span className="coin" /> {formatNumber(coins, lang)}
          </span>
        </div>
        <div className="pill" role="radiogroup" aria-label={t('settings.interface')} style={{ padding: 3, gap: 0 }}>
          {(['ar', 'en'] as const).map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={lang === l}
              onClick={() => switchLang(l)}
              style={{ position: 'relative', padding: '5px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13, color: lang === l ? 'var(--accent-ink)' : 'var(--ink-2)' }}
            >
              {lang === l && <motion.span layoutId="lang-pill" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)', zIndex: 0 }} />}
              <span style={{ position: 'relative' }}>{l === 'ar' ? 'ع' : 'EN'}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div variants={itemVariants} style={{ display: 'grid', justifyItems: 'center', gap: 10, margin: '18px 0 8px' }}>
        <Logo size={46} />
        <p className="muted" style={{ margin: 0 }}>
          {t('app.tagline')}
        </p>
      </motion.div>

      {season && (
        <motion.div variants={itemVariants} className="season-banner" role="note">
          <span aria-hidden>{season.emoji}</span>
          <span className="grow">
            <b>{lang === 'ar' ? season.greetingAr : season.greetingEn}</b>
          </span>
          <button className="season-banner__btn" onClick={() => go('packs')}>
            {x.packs}
          </button>
        </motion.div>
      )}

      {firstTime && (
        <motion.button variants={itemVariants} whileTap={{ scale: 0.98 }} className="choice choice--tutorial" onClick={() => void useApp.getState().startTutorial()}>
          <span className="choice__badge" style={{ background: 'linear-gradient(135deg, var(--accent), var(--correct))' }}>
            🦉
          </span>
          <span className="choice__body">
            <span className="choice__title">{x.tutorial}</span>
            <span className="choice__desc" style={{ display: 'block' }}>
              {x.tutorialDesc}
            </span>
          </span>
        </motion.button>
      )}

      <AnimatePresence>
        {invite && (
          <motion.button
            className="invite-banner"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => void useDuel.getState().open(invite.id)}
          >
            <span className="invite-banner__av" style={{ background: colorOf(invite.from.color) }}>
              {invite.from.avatar}
            </span>
            <span className="grow">{sfmt(sxs.inviteFrom, { name: invite.from.displayName })} ⚔️</span>
            <b>{sxs.join}</b>
          </motion.button>
        )}
      </AnimatePresence>

      {saved && (
        <motion.div variants={itemVariants}>
          <Button block onClick={() => void resumeSaved(saved.mode === 'infinite' || saved.mode === 'custom' ? saved.mode : 'classic')}>
            <Icon name="play" /> {t('menu.resume')}
          </Button>
        </motion.div>
      )}

      <motion.div variants={itemVariants}>
        <Button variant="primary" block style={{ minHeight: 60, fontSize: 18 }} onClick={() => go('language', { intent: 'classic' })}>
          {t('menu.play')}
        </Button>
      </motion.div>

      <motion.button variants={itemVariants} whileTap={{ scale: 0.98 }} className="choice" onClick={() => go('daily')}>
        <span className="choice__badge" style={{ background: 'linear-gradient(135deg, var(--present), var(--gold))' }}>
          <Icon name="calendar" />
        </span>
        <span className="choice__body">
          <span className="choice__title">{t('menu.daily')}</span>
          <span className="choice__desc" style={{ display: 'block' }}>
            {t('daily.subtitle')}
          </span>
        </span>
        {streak > 0 && (
          <span className="choice__meta" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--danger)' }}>
            <Icon name="flame" /> {formatNumber(streak, lang)}
          </span>
        )}
      </motion.button>

      <motion.button variants={itemVariants} whileTap={{ scale: 0.98 }} className="choice" onClick={() => go('language', { intent: 'infinite' })}>
        <span className="choice__badge" style={{ background: 'linear-gradient(135deg, var(--correct), var(--accent))' }}>
          <Icon name="infinity" />
        </span>
        <span className="choice__body">
          <span className="choice__title">{t('menu.infinite')}</span>
          <span className="choice__desc" style={{ display: 'block' }}>
            {t('menu.infinite.desc')}
          </span>
        </span>
      </motion.button>

      <motion.button variants={itemVariants} whileTap={{ scale: 0.98 }} className="choice choice--duel" onClick={() => (useDuel.getState().prepare(), go('duel'))}>
        <span className="choice__badge choice__badge--duel" aria-hidden>
          <span className="swords">⚔️</span>
        </span>
        <span className="choice__body">
          <span className="choice__title">{sxs.duel}</span>
          <span className="choice__desc" style={{ display: 'block' }}>
            {sxs.duelDesc}
          </span>
        </span>
        <span className="choice__meta new-badge">{lang === 'ar' ? 'جديد' : 'NEW'}</span>
      </motion.button>

      <motion.div variants={itemVariants} className="modes">
        <motion.button whileTap={{ scale: 0.95 }} className="mode-tile" onClick={() => go('league')}>
          <span className="mode-tile__icon" aria-hidden>
            🏆
          </span>
          <span className="mode-tile__name">{x.league}</span>
          <span className="mode-tile__new">{x.newBadge}</span>
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} className="mode-tile" onClick={() => void useApp.getState().startSpeed()}>
          <span className="mode-tile__icon" aria-hidden>
            ⚡
          </span>
          <span className="mode-tile__name">{x.speed}</span>
          {speedBest > 0 && <span className="mode-tile__meta">{nfmt(x.speedBest, { n: speedBest }, lang)}</span>}
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} className="mode-tile" onClick={() => go('packs')}>
          <span className="mode-tile__icon" aria-hidden>
            🎒
          </span>
          <span className="mode-tile__name">{x.packs}</span>
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} className="mode-tile" onClick={() => go('archive')}>
          <span className="mode-tile__icon" aria-hidden>
            🗂️
          </span>
          <span className="mode-tile__name">{x.archive}</span>
        </motion.button>
      </motion.div>

      <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 4 }}>
        {tiles.map((x) => (
          <motion.button
            key={x.to}
            whileTap={{ scale: 0.94 }}
            className="card menu-tile"
            onClick={() => go(x.to)}
            style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: '14px 4px', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}
          >
            <Icon name={x.icon} />
            <span>{t(x.key)}</span>
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
    </>
  );
}

/** `?g=CODE` (group invite), `?d=ar|en` (today's daily), `?s=ar|en` (speed run) — handled once. */
function bootV3Links() {
  try {
    const url = new URL(location.href);
    const g = url.searchParams.get('g');
    const d = url.searchParams.get('d');
    const sp = url.searchParams.get('s');
    for (const k of ['g', 'd', 's']) url.searchParams.delete(k);
    if (g || d || sp) history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    const app = useApp.getState();
    if (g && /^[A-Za-z0-9]{6}$/.test(g)) openGroupLink(g);
    else if (d === 'ar' || d === 'en') {
      app.setPrefs({ puzzleLang: d });
      void app.loadDaily(d).then(() => useApp.getState().go('daily'));
    } else if (sp === 'ar' || sp === 'en') void app.startSpeed(sp);
  } catch {
    /* no location (tests) */
  }
}
