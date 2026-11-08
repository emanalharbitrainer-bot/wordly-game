import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { getPlayerId, useApp } from '../../app/store';
import { Skeleton } from '../../components/animations/Skeleton';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { msUntilRiyadhDate, tierOf, zoneOf } from '../../core/league/league';
import * as api from '../../services/v3/v3-client';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { colorOf, useProfile } from '../profile/profile-store';
import { errText, nfmt, num, v3 } from '../v3/strings';

import { peekPendingGroup, takePendingGroup } from './group-link';

type Tab = 'league' | 'groups';

export default function LeagueScreen() {
  const lang = useApp((s) => s.prefs.uiLang);
  const x = v3(lang);
  const [tab, setTab] = useState<Tab>(peekPendingGroup() ? 'groups' : 'league');
  const [state, setState] = useState<api.LeagueState | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setState(await api.leagueState(getPlayerId()));
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <ScreenHeader title={x.league} subtitle={x.leagueDesc} />
      <div className="pill" role="tablist" style={{ alignSelf: 'center', padding: 3, gap: 0, marginBottom: 14 }}>
        {(['league', 'groups'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ position: 'relative', padding: '7px 18px', borderRadius: 999, fontWeight: 700, color: tab === k ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
            {tab === k && <motion.span layoutId="league-tab" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
            <span style={{ position: 'relative' }}>{k === 'league' ? x.league : x.myGroups}</span>
          </button>
        ))}
      </div>
      {error ? (
        <div className="card stack center">
          <p style={{ margin: 0 }}>{x.err_offline}</p>
          <Button onClick={() => void load()}>↻</Button>
        </div>
      ) : !state ? (
        <div className="stack" aria-busy="true">
          <Skeleton h={120} r={18} />
          <Skeleton h={260} r={18} />
        </div>
      ) : !state.member ? (
        <JoinCard state={state} lang={lang} onJoined={setState} />
      ) : tab === 'league' ? (
        <LeagueTab state={state} lang={lang} />
      ) : (
        <GroupsTab lang={lang} />
      )}
    </>
  );
}

function JoinCard({ state, lang, onJoined }: { state: Extract<api.LeagueState, { member: false }>; lang: Lang; onJoined: (s: api.LeagueState) => void }) {
  const x = v3(lang);
  const identity = useProfile((s) => s.identity);
  const [name, setName] = useState(identity.name);
  const [busy, setBusy] = useState(false);
  const showToast = useApp((s) => s.showToast);
  const join = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      if (!identity.name) useProfile.getState().setIdentity({ name: n });
      onJoined(await api.leagueJoin(getPlayerId(), n, identity.avatar, identity.color));
      api.track('league_join', lang);
    } catch (e) {
      showToast(errText(e instanceof api.V3Error ? e.code : 'offline', lang), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="card stack league-join" variants={listVariants} initial="hidden" animate="show">
      <motion.div variants={itemVariants} className="center" style={{ fontSize: 48 }} aria-hidden>
        🏆
      </motion.div>
      <motion.h2 variants={itemVariants} className="center" style={{ margin: 0 }}>
        {x.joinTitle}
      </motion.h2>
      <motion.p variants={itemVariants} className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
        {x.joinBody}
      </motion.p>
      {state.points > 0 && (
        <motion.div variants={itemVariants} className="pill center" style={{ alignSelf: 'center' }}>
          ⭐ {nfmt(x.pending, { n: state.points }, lang)}
        </motion.div>
      )}
      {peekPendingGroup() && <div className="muted center" style={{ fontSize: 13 }}>{x.needLeague}</div>}
      <motion.label variants={itemVariants} className="field">
        <span>{x.joinName}</span>
        <input className="input" value={name} maxLength={24} dir="auto" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} />
      </motion.label>
      <motion.div variants={itemVariants}>
        <Button variant="primary" block disabled={busy || !name.trim()} onClick={() => void join()}>
          {x.joinBtn}
        </Button>
      </motion.div>
    </motion.div>
  );
}

function useCountdown(date: string) {
  const [ms, setMs] = useState(() => msUntilRiyadhDate(date));
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilRiyadhDate(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);
  return ms;
}

function LeagueTab({ state, lang }: { state: Extract<api.LeagueState, { member: true }>; lang: Lang }) {
  const x = v3(lang);
  const go = useApp((s) => s.go);
  const tier = tierOf(state.tier);
  const ms = useCountdown(state.week_end);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const size = state.board.length;
  return (
    <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
      <motion.div variants={itemVariants} className="card league-hero" style={{ ['--tier' as string]: tier.color }}>
        <span className="league-hero__icon" aria-hidden>
          {tier.icon}
        </span>
        <span className="grow">
          <span className="league-hero__tier">{lang === 'ar' ? `الدوري ${tier.ar}` : `${tier.en} league`}</span>
          <span className="league-hero__ends">
            {x.endsIn} {d > 0 && nfmt(x.days, { n: d }, lang)} {nfmt(x.hours, { n: h }, lang)}
          </span>
        </span>
        <span className="league-hero__pts">
          <b>{num(state.points, lang)}</b>
          <small>{x.points}</small>
        </span>
      </motion.div>

      {state.last && <LastWeek last={state.last} lang={lang} />}

      <motion.ol variants={itemVariants} className="lb" aria-label={x.league}>
        {state.board.map((r) => {
          const zone = zoneOf(r.rank, size, state.tier, r.points);
          return (
            <li key={r.handle} className={`lb__row zone-${zone}${r.me ? ' is-me' : ''}`}>
              <span className="lb__rank">{num(r.rank, lang)}</span>
              <span className="lb__av" style={{ background: colorOf(r.color) }}>
                {r.avatar}
              </span>
              <span className="lb__name">
                {r.name}
                {r.me && <small> · {x.you}</small>}
              </span>
              <span className="lb__pts">{num(r.points, lang)}</span>
            </li>
          );
        })}
      </motion.ol>
      <motion.div variants={itemVariants} className="lb-legend">
        {state.tier < 5 && <span className="zone-up">▲ {x.promoZone}</span>}
        {state.tier > 1 && size >= 8 && <span className="zone-down">▼ {x.demoteZone}</span>}
      </motion.div>
      {size <= 1 && (
        <motion.p variants={itemVariants} className="muted center" style={{ margin: 0, fontSize: 13 }}>
          {x.alone}
        </motion.p>
      )}
      <motion.div variants={itemVariants}>
        <Button variant="primary" block onClick={() => go('daily')}>
          {x.playDaily}
        </Button>
      </motion.div>
      <motion.p variants={itemVariants} className="muted center" style={{ margin: 0, fontSize: 12 }}>
        {x.rules}
      </motion.p>
    </motion.div>
  );
}

function LastWeek({ last, lang }: { last: api.LastWeek; lang: Lang }) {
  const x = v3(lang);
  const [claimed, setClaimed] = useState(last.claimed);
  const [msg, setMsg] = useState<string | null>(null);
  const nowTier = tierOf(last.tier + (last.outcome === 'up' ? 1 : last.outcome === 'down' ? -1 : 0));
  const tierName = lang === 'ar' ? nowTier.ar : nowTier.en;
  const text = last.outcome === 'up' ? nfmt(x.lastUp, { tier: tierName }, lang) : last.outcome === 'down' ? nfmt(x.lastDown, { tier: tierName }, lang) : nfmt(x.lastStay, { tier: tierName, rank: last.rank }, lang);
  const claim = async () => {
    try {
      const r = await api.leagueClaim(getPlayerId(), last.week_start);
      setClaimed(true);
      if (!r.ok) return;
      if (useProfile.getState().grantShield()) setMsg(x.claimedShield);
      else {
        useApp.getState().addCoins(30);
        setMsg(x.claimedCoins);
      }
    } catch {
      useApp.getState().showToast(x.err_offline, 'error');
    }
  };
  return (
    <motion.div variants={itemVariants} className={`card league-last is-${last.outcome}`}>
      <div>{text}</div>
      {last.reward && !claimed && (
        <Button variant="primary" onClick={() => void claim()}>
          🎁 {x.claim}
        </Button>
      )}
      {msg && <div className="muted">{msg}</div>}
    </motion.div>
  );
}

function GroupsTab({ lang }: { lang: Lang }) {
  const x = v3(lang);
  const showToast = useApp((s) => s.showToast);
  const [groups, setGroups] = useState<api.GroupSummary[] | null>(null);
  const [open, setOpen] = useState<api.GroupBoard | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const player = getPlayerId();

  const refresh = useCallback(() => api.groupsMine(player).then(setGroups, () => setGroups([])), [player]);
  const fail = (e: unknown) => showToast(errText(e instanceof api.V3Error ? e.code : 'offline', lang), 'error');

  const doJoin = useCallback(
    async (c: string) => {
      setBusy(true);
      try {
        const g = await api.groupJoin(player, c);
        setOpen(g);
        showToast(nfmt(x.joinedGroup, { name: g.name }, lang), 'success');
        api.track('group_join');
        void refresh();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player, lang],
  );

  useEffect(() => {
    void refresh();
    const c = takePendingGroup();
    if (c) void doJoin(c);
  }, [refresh, doJoin]);

  const create = async () => {
    setBusy(true);
    try {
      const g = await api.groupCreate(player, name);
      setName('');
      setOpen(g);
      api.track('group_create');
      void refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (open) return <GroupBoardView board={open} lang={lang} onBack={() => (setOpen(null), void refresh())} />;

  return (
    <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
      {groups === null ? (
        <Skeleton h={80} r={18} />
      ) : groups.length === 0 ? (
        <motion.p variants={itemVariants} className="muted center" style={{ margin: 0, lineHeight: 1.7 }}>
          {x.noGroups}
        </motion.p>
      ) : (
        groups.map((g) => (
          <motion.button
            key={g.code}
            variants={itemVariants}
            whileTap={{ scale: 0.98 }}
            className="choice"
            onClick={() =>
              api.groupBoard(player, g.code).then(setOpen, (e) => fail(e))
            }
          >
            <span className="choice__badge" style={{ background: 'linear-gradient(135deg, var(--accent), var(--present))' }}>
              👥
            </span>
            <span className="choice__body">
              <span className="choice__title">{g.name}</span>
              <span className="choice__desc" style={{ display: 'block' }}>
                {nfmt(x.members, { n: g.members }, lang)} · {g.code}
              </span>
            </span>
          </motion.button>
        ))
      )}
      <motion.div variants={itemVariants} className="card stack">
        <b>{x.createGroup}</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input grow" value={name} maxLength={24} dir="auto" placeholder={x.groupName} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" disabled={busy || name.trim().length < 2} onClick={() => void create()}>
            {x.create}
          </Button>
        </div>
      </motion.div>
      <motion.div variants={itemVariants} className="card stack">
        <b>{x.joinByCode}</b>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input grow" value={code} maxLength={6} dir="ltr" placeholder={x.code} style={{ textTransform: 'uppercase', letterSpacing: '0.2em' }} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <Button disabled={busy || code.length !== 6} onClick={() => void doJoin(code)}>
            {x.join}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function GroupBoardView({ board, lang, onBack }: { board: api.GroupBoard; lang: Lang; onBack: () => void }) {
  const x = v3(lang);
  const showToast = useApp((s) => s.showToast);
  const invite = async () => {
    const link = api.groupLink(board.code);
    const text = `${nfmt(x.inviteText, { name: board.name }, lang)}\n${link}`;
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        showToast(x.linkCopied, 'success');
      }
      api.track('share', 'group');
    } catch {
      /* cancelled */
    }
  };
  const leave = async () => {
    await api.groupLeave(getPlayerId(), board.code).catch(() => undefined);
    onBack();
  };
  return (
    <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
      <motion.div variants={itemVariants} className="card league-hero" style={{ ['--tier' as string]: 'var(--accent)' }}>
        <span className="league-hero__icon" aria-hidden>
          👥
        </span>
        <span className="grow">
          <span className="league-hero__tier">{board.name}</span>
          <span className="league-hero__ends" dir="ltr">
            {board.code}
          </span>
        </span>
        <Button onClick={() => void invite()}>{x.invite}</Button>
      </motion.div>
      <motion.ol variants={itemVariants} className="lb">
        {board.board.map((r) => (
          <li key={r.handle} className={`lb__row${r.me ? ' is-me' : ''}`}>
            <span className="lb__rank">{num(r.rank, lang)}</span>
            <span className="lb__av" style={{ background: colorOf(r.color) }}>
              {r.avatar}
            </span>
            <span className="lb__name">
              {r.name} <small aria-label="tier">{tierOf(r.tier ?? 1).icon}</small>
              {r.me && <small> · {x.you}</small>}
            </span>
            <span className="lb__pts">{num(r.points, lang)}</span>
          </li>
        ))}
      </motion.ol>
      <motion.div variants={itemVariants} style={{ display: 'flex', gap: 10 }}>
        <Button block onClick={onBack}>
          {x.back}
        </Button>
        <Button block onClick={() => void leave()}>
          {x.leave}
        </Button>
      </motion.div>
    </motion.div>
  );
}
