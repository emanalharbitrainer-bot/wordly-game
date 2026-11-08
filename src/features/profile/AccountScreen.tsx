import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { useState } from 'react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { spring } from '../../styles/motion';
import { haptic } from '../assistant/assistant-store';
import { errText, sfmt, sx } from '../social/i18n';
import { AvatarRing } from './parts';
import { useProfile } from './profile-store';

/** Optional account: sign up / log in to save progress to the cloud and add friends. */
export default function AccountScreen() {
  const lang = useApp((s) => s.prefs.uiLang);
  const back = useApp((s) => s.back);
  const showToast = useApp((s) => s.showToast);
  const { account, identity, progress, signup, login, logout, changePassword } = useProfile();
  const s = sx(lang);
  const [tab, setTab] = useState<'signup' | 'login'>('signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formRef, animateEl] = useAnimate<HTMLFormElement>();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const validUser = /^[a-z0-9_]{3,20}$/.test(username.trim().toLowerCase());
  const submit = async () => {
    if (busy) return;
    setError('');
    if (!validUser) return fail(s.err.username);
    if (password.length < 6) return fail(s.err.password);
    setBusy(true);
    try {
      if (tab === 'signup') await signup(username, password);
      else await login(username, password);
      haptic([10, 40, 20]);
      showToast(sfmt(s.welcome, { name: useProfile.getState().identity.name }), 'success');
      back();
    } catch (e) {
      fail(errText(lang, e));
    } finally {
      setBusy(false);
    }
  };
  const fail = (m: string) => {
    setError(m);
    if (formRef.current) void animateEl(formRef.current, { x: [0, -9, 8, -6, 5, -3, 0] }, { duration: 0.38 });
    haptic([20, 30, 20]);
  };

  if (account) {
    return (
      <>
        <ScreenHeader title={s.account} />
        <div className="acc stack">
          <div className="acc__me card">
            <AvatarRing avatar={identity.avatar} color={identity.color} xp={progress.xp} size={72} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{identity.name}</div>
              <div className="muted" dir="ltr">
                @{account.username}
              </div>
              <div className="sync sync--ok" style={{ fontSize: 12, marginTop: 4 }}>
                ☁️ {s.synced}
              </div>
            </div>
          </div>
          <div className="card stack" style={{ padding: 16 }}>
            <b>{s.changePw}</b>
            <input className="input" type="password" autoComplete="current-password" placeholder={s.oldPw} value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            <input className="input" type="password" autoComplete="new-password" placeholder={s.newPw} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <Button
              block
              disabled={busy || oldPw.length < 1 || newPw.length < 6}
              onClick={async () => {
                setBusy(true);
                try {
                  await changePassword(oldPw, newPw);
                  showToast(s.pwChanged, 'success');
                  setOldPw('');
                  setNewPw('');
                } catch (e) {
                  showToast(errText(lang, e), 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {s.changePw}
            </Button>
          </div>
          <Button block onClick={() => void logout().then(back)}>
            🚪 {s.logout}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={s.account} />
      <div className="acc stack">
        <motion.div className="acc__why card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="acc__cloud" aria-hidden>
            <motion.span animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}>
              ☁️
            </motion.span>
          </div>
          {s.whyAccount.map((x, i) => (
            <motion.div key={x} initial={{ opacity: 0, x: lang === 'ar' ? 12 : -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
              {x}
            </motion.div>
          ))}
          <small className="muted">{s.optional}</small>
        </motion.div>

        <div className="seg-slider acc__tabs" data-on={tab === 'login' ? 1 : 0} role="tablist">
          {(['signup', 'login'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => (setTab(k), setError(''))}>
              <span>{k === 'signup' ? s.signup : s.login}</span>
            </button>
          ))}
        </div>

        <motion.form
          ref={formRef}
          className="card stack acc__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span>{s.username}</span>
            <div className="input-wrap" dir="ltr">
              <span className="input-at">@</span>
              <input
                className="input"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={username}
                maxLength={20}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
              <AnimatePresence>
                {validUser && (
                  <motion.span className="input-ok" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.bouncy}>
                    ✓
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <small>{s.usernameHint}</small>
          </label>
          <label className="field">
            <span>{s.password}</span>
            <input className="input" type="password" autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} value={password} maxLength={72} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
            {tab === 'signup' && (
              <div className="pw-meter">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={password.length >= [1, 6, 10][i] ? `on-${i}` : ''} />
                ))}
                <small>{s.passwordHint}</small>
              </div>
            )}
          </label>
          <AnimatePresence>
            {error && (
              <motion.div className="acc__err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {error}
              </motion.div>
            )}
          </AnimatePresence>
          <Button variant="primary" block type="submit" disabled={busy}>
            {busy ? <span className="dots" /> : tab === 'signup' ? s.signup : s.login}
          </Button>
        </motion.form>
      </div>
    </>
  );
}
