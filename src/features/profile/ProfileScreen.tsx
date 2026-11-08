import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import { CountUp } from '../../components/animations/CountUp';
import { Button, IconButton } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { Sheet } from '../../components/modals/Sheet';
import { flameColors, flameTier, levelInfo, recentDays, streakInfo } from '../../core/progress/progress-engine';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import type { Difficulty } from '../../types';
import { haptic } from '../assistant/assistant-store';
import { daysText, num, sfmt, sx } from '../social/i18n';
import { Flame, MiniFlame } from './Flame';
import { AvatarRing, XpBar } from './parts';
import { AVATARS, COLORS, useProfile } from './profile-store';
import { shareText } from '../../utils/share';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
const RANK_DIFF: (Difficulty | null)[] = [null, 'easy', 'normal', 'hard', 'expert'];

export default function ProfileScreen() {
  const lang = useApp((s) => s.prefs.uiLang);
  const t = useApp((s) => s.t);
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const { progress, identity, account, sync } = useProfile();
  const s = sx(lang);
  const st = streakInfo(progress);
  const tier = flameTier(st.count);
  const li = levelInfo(progress.xp);
  const days = useMemo(() => recentDays(progress, 14), [progress]);
  const [edit, setEdit] = useState(false);
  const words = Object.keys(progress.words).length;
  const { w, l, d } = progress.duelStats;
  const nextIn = tier.next ? tier.next - st.count : 0;
  const prevMin = [0, 1, 3, 7, 14, 30, 100][tier.tier];
  const tierPct = tier.next ? (st.count - prevMin) / (tier.next - prevMin) : 1;

  const share = async () => {
    const txt = lang === 'ar'
      ? `${identity.avatar} ${identity.name || s.guest} في WORDLY\n⭐ المستوى ${li.level} · ${li.title.ar}\n🔥 ستريك ${st.count} يوم (الأفضل ${st.best})\n📚 ${words} كلمة تعلّمتها\n⚔️ ${w} فوز في المبارزات`
      : `${identity.avatar} ${identity.name || s.guest} on WORDLY\n⭐ Level ${li.level} · ${li.title.en}\n🔥 ${st.count}-day streak (best ${st.best})\n📚 ${words} words learned\n⚔️ ${w} duel wins`;
    const r = await shareText(`${txt}\n${location.origin}`);
    if (r === 'copied') showToast(s.copied, 'success');
  };

  return (
    <>
      <ScreenHeader
        title={s.profile}
        end={
          <IconButton label={s.editProfile} onClick={() => setEdit(true)}>
            <span style={{ fontSize: 18 }}>✏️</span>
          </IconButton>
        }
      />
      <motion.div className="prof" variants={listVariants} initial="hidden" animate="show">
        <motion.section variants={itemVariants} className="prof-hero card">
          <AvatarRing avatar={identity.avatar} color={identity.color} xp={progress.xp} size={92} />
          <div className="prof-hero__body">
            <div className="prof-hero__name">{identity.name || s.guest}</div>
            <div className="prof-hero__user">
              {account ? (
                <>
                  @{account.username} · <span className={`sync sync--${sync}`}>{sync === 'syncing' ? s.syncing : sync === 'error' ? s.syncError : s.synced}</span>
                </>
              ) : (
                <button className="prof-hero__save" onClick={() => go('account')}>
                  ☁️ {s.saveProgress}
                </button>
              )}
            </div>
            <XpBar from={progress.xp} to={progress.xp} lang={lang} />
          </div>
        </motion.section>

        <motion.section variants={itemVariants} className={`prof-flame card tier-${tier.tier}`} style={{ ['--fc' as string]: flameColors(st.count ? st.difficulty : null).mid }}>
          <div className="prof-flame__stage">
            <Flame count={st.count} difficulty={st.difficulty} size={150} dim={st.atRisk} />
          </div>
          <div className="prof-flame__info">
            <div className="prof-flame__eyebrow">{s.streak}</div>
            <div className="prof-flame__count">
              {daysText(st.count, lang)}
              <span className="prof-flame__tier">{tier.name[lang]}</span>
            </div>
            <div className={`prof-flame__state${st.atRisk ? ' is-risk' : ''}`}>{st.count === 0 ? s.noStreak : st.atRisk ? s.atRisk : s.safeToday}</div>
            <div className="prof-flame__next">
              <div className="mini-track">
                <motion.div className="mini-track__fill" style={{ transformOrigin: lang === 'ar' ? '100% 50%' : '0% 50%' }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.04, tierPct) }} transition={{ duration: 1, delay: 0.4 }} />
              </div>
              <span>{tier.next ? sfmt(s.nextTier, { n: daysText(nextIn, lang) }) : s.maxTier}</span>
            </div>
            <div className="prof-flame__meta">
              <span title={s.shieldInfo}>
                {Array.from({ length: 2 }, (_, i) => (
                  <motion.span key={i} className={`shield${i < st.shields ? ' is-on' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.bouncy, delay: 0.6 + i * 0.1 }}>
                    🛡️
                  </motion.span>
                ))}
              </span>
              <span>
                {s.best}: <b>{num(st.best, lang)}</b>
              </span>
            </div>
          </div>
          <div className="prof-days" aria-label="14 days">
            {days.map((x, i) => {
              const dd = RANK_DIFF[x.rank];
              return (
                <motion.div
                  key={x.key}
                  className={`prof-day${x.today ? ' is-today' : ''}${x.rank ? ' is-won' : ''}${x.shielded ? ' is-shield' : ''}`}
                  initial={{ opacity: 0, y: 8, scale: 0.6 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...spring.bouncy, delay: 0.3 + i * 0.03 }}
                  title={x.key}
                >
                  {x.rank ? <MiniFlame count={1} difficulty={dd} size={14} /> : x.shielded ? '🛡️' : <span className="prof-day__dot" />}
                  <small>{new Date(`${x.key}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { weekday: 'narrow' })}</small>
                </motion.div>
              );
            })}
          </div>
          <div className="prof-legend">
            {DIFFS.map((dd) => (
              <span key={dd} className={st.difficulty === dd && st.count ? 'is-on' : ''}>
                <MiniFlame count={1} difficulty={dd} size={12} /> {t(`diff.${dd}` as never)}
              </span>
            ))}
          </div>
          <p className="prof-flame__hint">
            {s.streakHint}. {s.streakColorHint}.
          </p>
        </motion.section>

        <motion.section variants={itemVariants} className="prof-stats">
          {[
            { k: s.wordsLearned, v: words, icon: '📚', to: 'words' as const },
            { k: s.totalXp, v: progress.xp, icon: '⭐' },
            { k: s.duels, v: w, icon: '⚔️', sub: `${num(w, lang)} / ${num(l, lang)} / ${num(d, lang)}` },
            { k: s.best, v: st.best, icon: '🔥' },
          ].map((x, i) => (
            <motion.button key={x.k} className="prof-stat card" whileTap={{ scale: 0.95 }} onClick={() => x.to && go(x.to)} transition={spring.snappy}>
              <span className="prof-stat__icon">{x.icon}</span>
              <b>
                <CountUp value={x.v} lang={lang} />
              </b>
              <small>{x.sub ? `${x.k} · ${x.sub}` : x.k}</small>
              <span className="prof-stat__shine" style={{ animationDelay: `${i * 0.4}s` }} />
            </motion.button>
          ))}
        </motion.section>

        <motion.section variants={itemVariants} className="stack">
          <Button variant="primary" block className="btn--duel" onClick={() => go('duel')}>
            ⚔️ {s.duel}
          </Button>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button block onClick={() => go('words')}>
              📚 {s.myWords}
            </Button>
            <Button block onClick={() => go('friends')}>
              👥 {s.friends}
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button block onClick={() => go('account')}>
              {account ? '⚙️' : '☁️'} {s.account}
            </Button>
            <Button block onClick={() => void share()}>
              🪪 {s.shareCard}
            </Button>
          </div>
          {!account && <p className="muted center" style={{ fontSize: 12, margin: 0 }}>{s.guestNote}</p>}
        </motion.section>
      </motion.div>
      <EditSheet open={edit} onClose={() => setEdit(false)} />
    </>
  );
}

function EditSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const s = sx(lang);
  const { identity, setIdentity, sound, setSound } = useProfile();
  const [name, setName] = useState(identity.name);
  return (
    <Sheet open={open} onClose={() => (setIdentity({ name }), onClose())} label={s.editProfile}>
      <h2 className="sheet__title">{s.editProfile}</h2>
      <div className="edit">
        <AnimatePresence mode="popLayout">
          <motion.div key={identity.avatar + identity.color} className="edit__preview" initial={{ scale: 0.5, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={spring.bouncy}>
            <AvatarRing avatar={identity.avatar} color={identity.color} xp={useProfile.getState().progress.xp} size={74} />
          </motion.div>
        </AnimatePresence>
        <label className="field">
          <span>{s.name}</span>
          <input value={name} maxLength={24} dir="auto" placeholder={s.namePh} onChange={(e) => setName(e.target.value)} onBlur={() => setIdentity({ name })} />
        </label>
        <div className="field">
          <span>{s.avatar}</span>
          <div className="edit__avatars">
            {AVATARS.map((a) => (
              <motion.button key={a} type="button" whileTap={{ scale: 0.8 }} className={identity.avatar === a ? 'is-on' : ''} onClick={() => (haptic(6), setIdentity({ avatar: a }))}>
                {a}
              </motion.button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{s.color}</span>
          <div className="edit__colors">
            {Object.entries(COLORS).map(([k, v]) => (
              <motion.button key={k} type="button" aria-label={k} whileTap={{ scale: 0.8 }} className={identity.color === k ? 'is-on' : ''} style={{ background: v }} onClick={() => (haptic(6), setIdentity({ color: k }))} />
            ))}
          </div>
        </div>
        <label className="toggle-row">
          <span>🔊 {s.sound}</span>
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
        </label>
        <Button variant="primary" block onClick={() => (setIdentity({ name }), onClose())}>
          {s.done}
        </Button>
      </div>
    </Sheet>
  );
}
