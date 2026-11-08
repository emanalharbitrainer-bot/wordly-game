import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import type { StringKey } from '../../core/localization/ui-strings';
import type { Preferences } from '../../services/persistence/repositories';
import { itemVariants, listVariants, spring } from '../../styles/motion';

function Segmented<T extends string>({ id, value, options, onChange, label }: { id: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="pill" role="radiogroup" aria-label={label} style={{ padding: 3, gap: 0 }}>
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} style={{ position: 'relative', padding: '6px 12px', borderRadius: 999, fontWeight: 600, fontSize: 13, color: value === o.v ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
          {value === o.v && <motion.span layoutId={`seg-${id}`} transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
          <span style={{ position: 'relative' }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ width: 50, height: 30, borderRadius: 999, padding: 3, background: on ? 'var(--accent)' : 'var(--line-strong)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 220ms' }}>
      <motion.span layout transition={spring.snappy} style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
    </button>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <motion.div variants={itemVariants} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 140 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {desc && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {desc}
          </div>
        )}
      </div>
      {children}
    </motion.div>
  );
}

export default function SettingsScreen() {
  const { t, prefs, setPrefs, resetStats } = useApp();
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof Preferences>(k: K) => (v: Preferences[K]) => setPrefs({ [k]: v } as Partial<Preferences>);
  const langOpts = [
    { v: 'ar' as const, label: 'العربية' },
    { v: 'en' as const, label: 'English' },
  ];

  return (
    <>
      <ScreenHeader title={t('settings.title')} />
      <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
        <Row title={t('settings.interface')}>
          <Segmented id="ui" label={t('settings.interface')} value={prefs.uiLang} options={langOpts} onChange={set('uiLang')} />
        </Row>
        <Row title={t('settings.puzzle')}>
          <Segmented id="pz" label={t('settings.puzzle')} value={prefs.puzzleLang} options={langOpts} onChange={set('puzzleLang')} />
        </Row>
        <Row title={t('settings.theme')}>
          <Segmented
            id="theme"
            label={t('settings.theme')}
            value={prefs.theme}
            options={(['system', 'light', 'dark'] as const).map((v) => ({ v, label: t(`settings.theme.${v}` as StringKey) }))}
            onChange={set('theme')}
          />
        </Row>
        <Row title={t('settings.motion')}>
          <Segmented
            id="motion"
            label={t('settings.motion')}
            value={prefs.reducedMotion}
            options={(['system', 'on', 'off'] as const).map((v) => ({ v, label: t(`settings.motion.${v}` as StringKey) }))}
            onChange={set('reducedMotion')}
          />
        </Row>
        <Row title={t('settings.contrast')} desc={t('settings.contrast.desc')}>
          <Toggle on={prefs.highContrast} onChange={set('highContrast')} label={t('settings.contrast')} />
        </Row>
        <Row title={t('settings.physical')} desc={t('settings.physical.desc')}>
          <Toggle on={prefs.physicalKeyboard} onChange={set('physicalKeyboard')} label={t('settings.physical')} />
        </Row>
        <motion.div variants={itemVariants}>
          <Button
            block
            variant="ghost"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              if (confirm) {
                resetStats();
                setConfirm(false);
              } else setConfirm(true);
            }}
          >
            {confirm ? t('settings.resetConfirm') : t('settings.reset')}
          </Button>
        </motion.div>
        <motion.p variants={itemVariants} className="muted center" style={{ fontSize: 11, lineHeight: 1.6 }}>
          {t('settings.about')}: SCOWL (English) · pyspellchecker Arabic frequency list · curated answers
        </motion.p>
      </motion.div>
    </>
  );
}
