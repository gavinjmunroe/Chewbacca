"use client";
import React, { useReducer } from "react";
import OnboardingScreen from "./screens/OnboardingScreen";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import SessionsScreen from "./screens/SessionsScreen";
import CoachingScreen from "./screens/CoachingScreen";
import SessionDetailScreen from "./screens/SessionDetailScreen";
import ProfileScreen from "./screens/ProfileScreen";
import DeviceConnectionScreen from "./screens/DeviceConnectionScreen";
import ChatScreen from "./screens/ChatScreen";
import LiveSessionScreen from "./screens/LiveSessionScreen";
import SessionCompleteScreen from "./screens/SessionCompleteScreen";

type Screen =
  | "onboarding"
  | "login"
  | "deviceConnection"
  | "home"
  | "sessions"
  | "coaching"
  | "chat"
  | "liveSession"
  | "sessionComplete"
  | "sessionDetail"
  | "profile";
type Tab = "home" | "sessions" | "chat" | "profile";

const MAIN_TABS: Tab[] = ["home", "sessions", "chat", "profile"];
const AUTH_SCREENS: Screen[] = ["onboarding", "login", "deviceConnection"];
const PUSH_SCREENS: Screen[] = ["coaching", "sessionDetail", "liveSession", "sessionComplete"];

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#0B1120',
          padding: 32, fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#EF4444', marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 24, textAlign: 'center' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{ background: '#2563EB', border: 'none', borderRadius: 12, padding: '10px 24px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const FULL_SCREEN: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  overflow: 'hidden',
};

// ── AppShell state & reducer ─────────────────────────────────────────────────

type SessionResult = { duration: number; env: string; metrics: Record<string, number> };

interface AppState {
  screen: Screen;
  activeTab: Tab;
  prevScreen: Screen | null;
  selectedSessionId: string;
  pushAnimKey: number;
  sessionOriginTab: Tab;
  sessionResult: SessionResult | null;
  chatBadge: boolean;
  mountedTabs: Set<Tab>;
}

type AppAction =
  | { type: 'NAVIGATE'; payload: Screen; currentTab: Tab }
  | { type: 'TAB_CHANGE'; payload: Tab }
  | { type: 'SELECT_SESSION'; id: string; originTab: Tab }
  | { type: 'SESSION_END'; result: SessionResult }
  | { type: 'LOG_OUT' };

function initAppState(): AppState {
  const screen: Screen = (() => {
    if (typeof window === 'undefined') return 'onboarding';
    try {
      const saved = sessionStorage.getItem('tz_screen');
      const restorable = ['home', 'sessions', 'coaching', 'chat', 'profile'];
      if (saved && restorable.includes(saved)) return saved as Screen;
    } catch {}
    return 'onboarding';
  })();
  const activeTab: Tab = (() => {
    if (typeof window === 'undefined') return 'home';
    try {
      const saved = sessionStorage.getItem('tz_tab');
      if (saved && MAIN_TABS.includes(saved as Tab)) return saved as Tab;
    } catch {}
    return 'home';
  })();
  const mountedTabs = new Set<Tab>(['home']);
  if (typeof window !== 'undefined') {
    try {
      const saved = sessionStorage.getItem('tz_tab');
      if (saved && MAIN_TABS.includes(saved as Tab)) mountedTabs.add(saved as Tab);
    } catch {}
  }
  return { screen, activeTab, prevScreen: null, selectedSessionId: '1', pushAnimKey: 0, sessionOriginTab: 'sessions', sessionResult: null, chatBadge: false, mountedTabs };
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'NAVIGATE': {
      const next = action.payload;
      if (next === state.screen) return state;
      const mountedTabs = new Set(state.mountedTabs);
      if (MAIN_TABS.includes(next as Tab)) mountedTabs.add(next as Tab);
      const pushAnimKey = PUSH_SCREENS.includes(next) ? state.pushAnimKey + 1 : state.pushAnimKey;
      try {
        sessionStorage.setItem('tz_screen', next);
        sessionStorage.setItem('tz_tab', action.currentTab);
      } catch {}
      return { ...state, screen: next, prevScreen: state.screen, pushAnimKey, mountedTabs };
    }
    case 'TAB_CHANGE': {
      const tab = action.payload;
      const mountedTabs = new Set(state.mountedTabs);
      mountedTabs.add(tab);
      const chatBadge = tab === 'chat' ? false : state.chatBadge;
      const next = tab as Screen;
      try {
        sessionStorage.setItem('tz_screen', next);
        sessionStorage.setItem('tz_tab', tab);
      } catch {}
      return { ...state, activeTab: tab, mountedTabs, chatBadge, screen: next, prevScreen: state.screen };
    }
    case 'SELECT_SESSION': {
      const mountedTabs = new Set(state.mountedTabs);
      if (!mountedTabs.has('sessions')) mountedTabs.add('sessions');
      return { ...state, selectedSessionId: action.id, sessionOriginTab: action.originTab, screen: 'sessionDetail', prevScreen: state.screen, pushAnimKey: state.pushAnimKey + 1, mountedTabs };
    }
    case 'SESSION_END':
      return { ...state, sessionResult: action.result, screen: 'sessionComplete', prevScreen: state.screen, pushAnimKey: state.pushAnimKey + 1 };
    case 'LOG_OUT': {
      try { sessionStorage.clear(); } catch {}
      return { ...state, screen: 'onboarding', prevScreen: state.screen, activeTab: 'home', mountedTabs: new Set<Tab>(['home']), chatBadge: false };
    }
    default:
      return state;
  }
}

export default function AppShell() {
  const [state, dispatch] = useReducer(appReducer, undefined, initAppState);
  const { screen, activeTab, prevScreen, selectedSessionId, pushAnimKey, sessionOriginTab, sessionResult, chatBadge, mountedTabs } = state;

  const navigate = (next: Screen) => dispatch({ type: 'NAVIGATE', payload: next, currentTab: activeTab });

  const handleTabChange = (tab: Tab) => dispatch({ type: 'TAB_CHANGE', payload: tab });

  const handleSelectSession = (id: string) => dispatch({ type: 'SELECT_SESSION', id, originTab: activeTab });

  const handleStartSession = () => navigate('liveSession');

  const handleSessionEnd = (result: { duration: number; env: string; metrics: { speechClarity: number; paceConsistency: number; vocalVariety: number; turnTaking: number } }) => {
    dispatch({ type: 'SESSION_END', result });
  };

  const handleLogOut = () => dispatch({ type: 'LOG_OUT' });

  const isAuthScreen = AUTH_SCREENS.includes(screen);
  const isPushScreen = PUSH_SCREENS.includes(screen);
  const isTabScreen = MAIN_TABS.includes(screen as Tab);
  const showBottomNav = isTabScreen;

  // Auth transition: first onboarding → fade, subsequent → forward slide
  const authClass = (!prevScreen || prevScreen === 'onboarding') ? 'screen-fade' : 'screen-forward';

  return (
    <ErrorBoundary>
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background: "#0B1120",
          fontFamily: "var(--font-dm-sans), var(--font-inter), system-ui, sans-serif",
        }}
      >
        {/* ── Auth screens (full-screen replace, animated) ────────────────── */}
        {isAuthScreen && (
          <div key={screen} className={authClass} style={FULL_SCREEN}>
            {screen === "onboarding" && (
              <OnboardingScreen onComplete={() => navigate("login")} />
            )}
            {screen === "login" && (
              <LoginScreen
                onLogin={() => navigate("deviceConnection")}
              />
            )}
            {screen === "deviceConnection" && (
              <DeviceConnectionScreen
                onConnected={() => handleTabChange("home")}
                onSkip={() => handleTabChange("home")}
              />
            )}
          </div>
        )}

        {/* ── Main tab screens (kept alive — show/hide via CSS) ───────────── */}
        {!isAuthScreen && MAIN_TABS.map(tab => {
          if (!mountedTabs.has(tab)) return null;
          const isActive = isTabScreen && activeTab === tab;
          return (
            <div
              key={tab}
              style={{
                ...FULL_SCREEN,
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              {tab === 'home' && (
                <HomeScreen
                  onNavigate={handleTabChange}
                  onViewProgress={() => navigate("coaching")}
                  onSelectSession={handleSelectSession}
                  onStartSession={handleStartSession}
                  onViewSessions={() => handleTabChange('sessions')}
                />
              )}
              {tab === 'sessions' && (
                <SessionsScreen onSelectSession={handleSelectSession} />
              )}
              {tab === 'chat' && <ChatScreen />}
              {tab === 'profile' && (
                <ProfileScreen onLogOut={handleLogOut} />
              )}
            </div>
          );
        })}

        {/* ── Push screen overlay (slides up, covers tabs + nav) ──────────── */}
        {isPushScreen && (
          <div
            key={pushAnimKey}
            className="screen-up"
            style={{ ...FULL_SCREEN, zIndex: 200 }}
          >
            {screen === "coaching" && (
              <CoachingScreen
                onSelectSession={handleSelectSession}
                onBack={() => navigate(activeTab as Screen)}
                onStartSession={handleStartSession}
                onChat={() => handleTabChange("chat")}
              />
            )}
            {screen === "sessionDetail" && (
              <SessionDetailScreen
                sessionId={selectedSessionId}
                onBack={() => handleTabChange(sessionOriginTab)}
                onCoach={() => handleTabChange("chat")}
              />
            )}
            {screen === "liveSession" && (
              <LiveSessionScreen onEnd={handleSessionEnd} />
            )}
            {screen === "sessionComplete" && sessionResult && (
              <SessionCompleteScreen
                result={sessionResult as { duration: number; env: string; metrics: { speechClarity: number; paceConsistency: number; vocalVariety: number; turnTaking: number } }}
                onDone={() => handleTabChange('sessions')}
              />
            )}
          </div>
        )}

        {/* ── Bottom Navigation ───────────────────────────────────────────── */}
        {showBottomNav && (
          <BottomNav
            activeTab={activeTab}
            onTabChange={handleTabChange}
            chatBadge={chatBadge}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

/* ─── Bottom Navigation ─────────────────────────────────────────────────── */

function BottomNav({
  activeTab,
  onTabChange,
  chatBadge,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  chatBadge: boolean;
}) {
  const tabs: {
    id: Tab;
    label: string;
    icon: (a: boolean) => React.ReactNode;
  }[] = [
    { id: "home",     label: "Home",     icon: HomeIcon },
    { id: "sessions", label: "Sessions", icon: SessionsIcon },
    { id: "chat",     label: "Coach",    icon: ChatIcon },
    { id: "profile",  label: "Profile",  icon: ProfileIcon },
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        minHeight: "74px",
        height: "auto",
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderTop: "1px solid #E9EAEC",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-around",
        paddingTop: "10px",
        paddingBottom: "env(safe-area-inset-bottom, 12px)",
        paddingLeft: "4px",
        paddingRight: "4px",
        zIndex: 100,
      }}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="tizzy-tap"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: "3px",
              padding: "0 4px",
              background: "none",
              border: "none",
              cursor: "pointer",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
              position: "relative",
            }}
          >
            {/* Icon with badge */}
            <div style={{ position: "relative" }}>
              {tab.icon(active)}
              {tab.id === "chat" && chatBadge && (
                <div style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  background: "#EF4444",
                  border: "1.5px solid rgba(255,255,255,0.97)",
                  color: "white",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }} >
                  1
                </div>
              )}
            </div>

            <span
              style={{
                fontSize: "10px",
                fontWeight: active ? 600 : 400,
                color: active ? "#2563EB" : "#8B96A4",
                letterSpacing: "0.01em",
                lineHeight: 1,
              }}
            >
              {tab.label}
            </span>

            {active && (
              <div style={{
                width: 3,
                height: 3,
                borderRadius: 2,
                background: "#2563EB",
                marginTop: 1,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Nav Icons ─────────────────────────────────────────────────────────── */

function HomeIcon(active: boolean): React.ReactNode {
  const c = active ? "#2563EB" : "#8B96A4";
  const w = active ? "2" : "1.6";
  return (
    <svg width="22" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 9.5L12 3L21 9.5V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V9.5Z"
        stroke={c}
        strokeWidth={w}
        strokeLinejoin="round"
        fill={active ? "#2563EB1A" : "none"}
      />
    </svg>
  );
}

function SessionsIcon(active: boolean): React.ReactNode {
  const c = active ? "#2563EB" : "#8B96A4";
  return (
    <svg width="22" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="4"    y="14" width="3" height="6"  rx="1.5" fill={c} opacity="0.55" />
      <rect x="9"    y="10" width="3" height="10" rx="1.5" fill={c} opacity="0.75" />
      <rect x="14"   y="6"  width="3" height="14" rx="1.5" fill={c} />
      <rect x="18.5" y="11" width="3" height="9"  rx="1.5" fill={c} opacity="0.65" />
    </svg>
  );
}

function ChatIcon(active: boolean): React.ReactNode {
  const c = active ? "#2563EB" : "#8B96A4";
  const w = active ? "2" : "1.6";
  return (
    <svg width="22" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 15C21 15.53 20.79 16.04 20.41 16.41C20.04 16.79 19.53 17 19 17H7L3 21V5C3 4.47 3.21 3.96 3.59 3.59C3.96 3.21 4.47 3 5 3H19C19.53 3 20.04 3.21 20.41 3.59C20.79 3.96 21 4.47 21 5V15Z"
        stroke={c}
        strokeWidth={w}
        strokeLinejoin="round"
        fill={active ? "#2563EB1A" : "none"}
      />
    </svg>
  );
}

function ProfileIcon(active: boolean): React.ReactNode {
  const c = active ? "#2563EB" : "#8B96A4";
  const w = active ? "2" : "1.6";
  return (
    <svg width="22" height="20" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12" cy="8" r="4"
        stroke={c} strokeWidth={w}
        fill={active ? "#2563EB1A" : "none"}
      />
      <path
        d="M4 20C4 16.69 7.58 14 12 14C16.42 14 20 16.69 20 20"
        stroke={c} strokeWidth={w}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
