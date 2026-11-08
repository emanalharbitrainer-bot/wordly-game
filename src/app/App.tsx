import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { lazy, Suspense, type ComponentType } from 'react';
import { ACHIEVEMENTS } from '../core/achievements/achievement-engine';
import type { StringKey } from '../core/localization/ui-strings';
import { MenuScreen } from '../features/home/MenuScreen';
import { SplashScreen } from '../features/home/SplashScreen';
import { GameScreen } from '../features/gameplay/GameScreen';
import { DifficultyScreen, LanguageScreen } from '../features/gameplay/SetupScreens';
import { useAppearance } from '../hooks/useAppearance';
import { screenVariants, spring } from '../styles/motion';
import { Assistant } from '../features/assistant/Assistant';
import { Celebrations } from '../features/profile/Celebrations';
import { useApp, type Screen } from './store';

// Secondary screens are code-split so the first paint only ships what the menu needs.
const StatsScreen = lazy(() => import('../features/statistics/StatsScreen'));
const AchievementsScreen = lazy(() => import('../features/achievements/AchievementsScreen'));
const SettingsScreen = lazy(() => import('../features/settings/SettingsScreen'));
const DailyScreen = lazy(() => import('../features/daily-challenge/DailyScreen'));
const HowToScreen = lazy(() => import('../features/onboarding/HowToScreen'));
const ProfileScreen = lazy(() => import('../features/profile/ProfileScreen'));
const WordsScreen = lazy(() => import('../features/profile/WordsScreen'));
const AccountScreen = lazy(() => import('../features/profile/AccountScreen'));
const FriendsScreen = lazy(() => import('../features/social/FriendsScreen'));
const DuelScreen = lazy(() => import('../features/social/DuelScreen'));
const LeagueScreen = lazy(() => import('../features/league/LeagueScreen'));
const ArchiveScreen = lazy(() => import('../features/archive/ArchiveScreen'));
const PacksScreen = lazy(() => import('../features/packs/PacksScreen'));

const SCREENS: Record<Screen, ComponentType> = {
  splash: SplashScreen,
  menu: MenuScreen,
  language: LanguageScreen,
  difficulty: DifficultyScreen,
  game: GameScreen,
  stats: StatsScreen,
  achievements: AchievementsScreen,
  settings: SettingsScreen,
  daily: DailyScreen,
  howto: HowToScreen,
  profile: ProfileScreen,
  words: WordsScreen,
  account: AccountScreen,
  friends: FriendsScreen,
  duel: DuelScreen,
  league: LeagueScreen,
  archive: ArchiveScreen,
  packs: PacksScreen,
};

export function App() {
  const { reduced } = useAppearance();
  const screen = useApp((s) => s.screen);
  const direction = useApp((s) => s.direction);
  const uiLang = useApp((s) => s.prefs.uiLang);
  const toast = useApp((s) => s.toast);
  const achToast = useApp((s) => s.achievementToast);
  const t = useApp((s) => s.t);
  const Current = SCREENS[screen];
  // horizontal drift follows the reading direction
  const dir = direction * (uiLang === 'ar' ? -1 : 1);
  const ach = ACHIEVEMENTS.find((a) => a.id === achToast);

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <div className="app">
        <AnimatePresence initial={false} custom={dir}>
          <motion.main
            key={screen}
            className={`screen${screen === 'game' || screen === 'duel' ? ' screen--game' : ''}`}
            custom={dir}
            variants={screenVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Suspense fallback={null}>
              <Current />
            </Suspense>
          </motion.main>
        </AnimatePresence>

        <Assistant />
        <Celebrations />

        <div className="toast-layer" aria-live="assertive">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                className="toast"
                role="alert"
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                transition={spring.snappy}
              >
                {toast.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {ach && (
            <motion.div
              key={ach.id}
              className="ach-toast"
              role="status"
              initial={{ y: -90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -90, opacity: 0 }}
              transition={spring.bouncy}
            >
              <div className="ach-toast__shine" />
              <motion.div className="ach-toast__icon" initial={{ rotate: -30, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.15 }}>
                {ach.icon}
              </motion.div>
              <div>
                <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('ach.new')}
                </div>
                <div style={{ fontWeight: 700 }}>{t(`ach.${ach.id}.title` as StringKey)}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
