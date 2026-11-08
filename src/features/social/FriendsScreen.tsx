import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { levelInfo } from '../../core/progress/progress-engine';
import * as api from '../../services/social/social-client';
import { spring } from '../../styles/motion';
import { haptic } from '../assistant/assistant-store';
import { MiniFlame } from '../profile/Flame';
import { colorOf, useProfile } from '../profile/profile-store';
import { useDuel } from './duel-store';
import { errText, num, sfmt, sx } from './i18n';

export default function FriendsScreen() {
  const lang = useApp((s) => s.prefs.uiLang);
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const { token, account } = useProfile();
  const s = sx(lang);
  const [friends, setFriends] = useState<api.PlayerCard[] | null>(null);
  const [invites, setInvites] = useState<api.Invite[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.friends(token);
      setFriends(r.friends);
      setInvites(r.invites);
    } catch (e) {
      showToast(errText(lang, e), 'error');
      setFriends([]);
    }
  }, [token, lang, showToast]);

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (!token || !account) {
    return (
      <>
        <ScreenHeader title={s.friends} />
        <motion.div className="card friends__gate" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="friends__gate-art" aria-hidden>
            {['🦊', '⚔️', '🐼'].map((x, i) => (
              <motion.span key={i} animate={{ y: [0, -8, 0], rotate: i === 1 ? [0, 12, -12, 0] : 0 }} transition={{ repeat: Infinity, duration: 2.2, delay: i * 0.2 }}>
                {x}
              </motion.span>
            ))}
          </div>
          <p>{s.needAccount}</p>
          <Button variant="primary" block onClick={() => go('account')}>
            ☁️ {s.createAccount}
          </Button>
          <Button block onClick={() => go('duel')}>
            🔗 {s.duel}
          </Button>
        </motion.div>
      </>
    );
  }

  const add = async () => {
    const u = name.trim().toLowerCase().replace(/^@/, '');
    if (!u || busy) return;
    setBusy(true);
    try {
      const r = await api.addFriend(token, u);
      haptic([10, 40, 10]);
      showToast(sfmt(s.added, { name: r.friend.displayName }), 'success');
      setName('');
      void load();
    } catch (e) {
      showToast(errText(lang, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenHeader title={s.friends} subtitle={sfmt(s.myUsername, { u: account.username })} />
      <div className="friends stack">
        <form
          className="friends__add card"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="input-wrap" dir="ltr">
            <span className="input-at">@</span>
            <input className="input" value={name} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={s.addPh} onChange={(e) => setName(e.target.value.toLowerCase())} />
          </div>
          <Button variant="primary" type="submit" disabled={busy || name.trim().length < 3}>
            {s.add}
          </Button>
        </form>

        <AnimatePresence>
          {invites.length > 0 && (
            <motion.section className="stack" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <div className="section-label">📨 {s.invites}</div>
              {invites.map((inv) => (
                <motion.div key={inv.id} className="invite card" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}>
                  <span className="invite__av" style={{ background: colorOf(inv.from.color) }}>
                    {inv.from.avatar}
                  </span>
                  <div className="grow">
                    <b>{sfmt(s.inviteFrom, { name: inv.from.displayName })}</b>
                    <small className="muted" style={{ display: 'block' }}>
                      {inv.lang === 'ar' ? 'عربي' : 'English'} · {num(inv.length, lang)} {lang === 'ar' ? 'حروف' : 'letters'} · {inv.maxAttempts ? num(inv.maxAttempts, lang) : '∞'}
                    </small>
                  </div>
                  <Button variant="primary" onClick={() => void useDuel.getState().open(inv.id)}>
                    {s.join}
                  </Button>
                </motion.div>
              ))}
            </motion.section>
          )}
        </AnimatePresence>

        {friends === null ? (
          <div className="friends__loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 68, borderRadius: 16 }} />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <p className="muted center">{s.noFriends}</p>
        ) : (
          <motion.div className="stack" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
            {friends.map((f) => {
              const li = levelInfo(f.xp);
              const n = f.streak?.n ?? 0;
              return (
                <motion.div key={f.username} className="fcard card" variants={{ hidden: { opacity: 0, x: lang === 'ar' ? 20 : -20 }, show: { opacity: 1, x: 0 } }}>
                  <span className="fcard__av" style={{ background: colorOf(f.color) }}>
                    {f.avatar}
                    <span className="fcard__lvl">{li.level}</span>
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="ellipsis">{f.displayName}</b>
                    <small className="muted ellipsis" style={{ display: 'block' }} dir="ltr">
                      @{f.username} · {li.title[lang]}
                    </small>
                  </div>
                  <span className="fcard__streak" title={s.streak}>
                    <MiniFlame count={n} difficulty={f.streak?.d ?? null} size={16} /> {num(n, lang)}
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => {
                      useDuel.getState().prepare({ invite: f.username, inviteName: f.displayName });
                      go('duel');
                    }}
                  >
                    ⚔️
                  </Button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </>
  );
}
