"use client";
import React, { useReducer, Component, type ReactNode } from "react";

// Minimal error boundary for individual screens
interface EBState { hasError: boolean }
class ScreenErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#050507" }}>
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 14 }}>
            <div style={{ marginBottom: 12 }}>Something went wrong.</div>
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{ color: "#A855F7", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 14 }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import OnboardingScreen from "./screens/OnboardingScreen";
import FeedScreen from "./screens/FeedScreen";
import ExploreScreen from "./screens/ExploreScreen";
import CreateScreen from "./screens/CreateScreen";
import CirclesScreen from "./screens/CirclesScreen";
import ChallengesScreen from "./screens/ChallengesScreen";
import ProfileScreen from "./screens/ProfileScreen";
import PostDetailScreen from "./screens/PostDetailScreen";
import CircleDetailScreen from "./screens/CircleDetailScreen";
import type { CultureChallenge } from "@/lib/types";

type Screen =
  | "onboarding"
  | "feed"
  | "explore"
  | "create"
  | "circles"
  | "challenges"
  | "profile"
  | "postDetail"
  | "circleDetail";

type Tab = "feed" | "explore" | "create" | "circles" | "profile";

interface AppState {
  screen: Screen;
  tab: Tab;
  selectedPostId: string | null;
  selectedCircleId: string | null;
  selectedChallenge: CultureChallenge | null;
}

type Action =
  | { type: "SET_TAB"; tab: Tab }
  | { type: "OPEN_POST"; postId: string }
  | { type: "OPEN_CIRCLE"; circleId: string }
  | { type: "GO_BACK" }
  | { type: "FINISH_ONBOARDING" }
  | { type: "OPEN_CHALLENGES" }
  | { type: "OPEN_CHALLENGE_CREATE"; challenge: CultureChallenge };

const FULL: React.CSSProperties = {
  width: "100%", height: "100%", position: "absolute", top: 0, left: 0, overflow: "hidden",
};

const TAB_SCREENS: Record<Tab, Screen> = {
  feed: "feed",
  explore: "explore",
  create: "create",
  circles: "circles",
  profile: "profile",
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "FINISH_ONBOARDING":
      return { ...state, screen: "feed", tab: "feed" };
    case "SET_TAB":
      return { ...state, tab: action.tab, screen: TAB_SCREENS[action.tab], selectedPostId: null, selectedCircleId: null, selectedChallenge: null };
    case "OPEN_POST":
      return { ...state, screen: "postDetail", selectedPostId: action.postId };
    case "OPEN_CIRCLE":
      return { ...state, screen: "circleDetail", selectedCircleId: action.circleId };
    case "OPEN_CHALLENGES":
      return { ...state, screen: "challenges" };
    case "OPEN_CHALLENGE_CREATE":
      return { ...state, screen: "create", tab: "create", selectedChallenge: action.challenge };
    case "GO_BACK":
      return { ...state, screen: TAB_SCREENS[state.tab], selectedPostId: null, selectedCircleId: null, selectedChallenge: null };
    default:
      return state;
  }
}

const initialState: AppState = {
  screen: "onboarding",
  tab: "feed",
  selectedPostId: null,
  selectedCircleId: null,
  selectedChallenge: null,
};

// Bottom tab bar icons
function FeedIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="2" fill={active ? "#A855F7" : "rgba(255,255,255,0.4)"} />
      <rect x="13" y="3" width="8" height="8" rx="2" fill={active ? "#A855F7" : "rgba(255,255,255,0.4)"} opacity="0.7" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill={active ? "#A855F7" : "rgba(255,255,255,0.4)"} opacity="0.7" />
      <rect x="13" y="13" width="8" height="8" rx="2" fill={active ? "#EC4899" : "rgba(255,255,255,0.4)"} opacity="0.5" />
    </svg>
  );
}

function ExploreIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#A855F7" : "rgba(255,255,255,0.4)"} strokeWidth="2">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, #7C3AED, #EC4899)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 20px rgba(124,58,237,0.4)" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
    </div>
  );
}

function CirclesIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#A855F7" : "rgba(255,255,255,0.4)"} strokeWidth="2">
      <circle cx="9" cy="12" r="4" /><circle cx="17" cy="8" r="3" /><circle cx="17" cy="16" r="3" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "#A855F7" : "rgba(255,255,255,0.4)"} strokeWidth="2">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

const AUTH_SCREENS: Screen[] = ["onboarding"];
const PUSH_SCREENS: Screen[] = ["postDetail", "circleDetail", "create", "challenges"];

export default function AppShell() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const isAuthScreen = AUTH_SCREENS.includes(state.screen);
  const isPushScreen = PUSH_SCREENS.includes(state.screen);
  const showBottomNav = !isAuthScreen;

  const navProps = { dispatch };

  const renderScreen = () => {
    switch (state.screen) {
      case "onboarding":
        return <ScreenErrorBoundary key="onboarding"><OnboardingScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "feed":
        return <ScreenErrorBoundary key="feed"><FeedScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "explore":
        return <ScreenErrorBoundary key="explore"><ExploreScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "create":
        return <ScreenErrorBoundary key="create"><CreateScreen dispatch={dispatch} style={FULL} challenge={state.selectedChallenge} /></ScreenErrorBoundary>;
      case "circles":
        return <ScreenErrorBoundary key="circles"><CirclesScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "challenges":
        return <ScreenErrorBoundary key="challenges"><ChallengesScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "profile":
        return <ScreenErrorBoundary key="profile"><ProfileScreen dispatch={dispatch} style={FULL} /></ScreenErrorBoundary>;
      case "postDetail":
        return <ScreenErrorBoundary key="postDetail"><PostDetailScreen dispatch={dispatch} postId={state.selectedPostId || ""} style={FULL} /></ScreenErrorBoundary>;
      case "circleDetail":
        return <ScreenErrorBoundary key="circleDetail"><CircleDetailScreen dispatch={dispatch} circleId={state.selectedCircleId || ""} style={FULL} /></ScreenErrorBoundary>;
      default:
        return null;
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", background: "#050507", position: "relative", overflow: "hidden" }}>
      {/* Screen */}
      <div style={{ position: "absolute", inset: 0, bottom: showBottomNav ? 80 : 0 }}>
        {renderScreen()}
      </div>

      {/* Bottom Nav */}
      {showBottomNav && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 80,
          background: "linear-gradient(to top, rgba(5,5,7,1) 0%, rgba(5,5,7,0.95) 80%, rgba(5,5,7,0) 100%)",
          display: "flex", alignItems: "flex-start", paddingTop: 12, paddingBottom: 20,
          backdropFilter: "blur(20px)",
        }}>
          {(["feed", "explore", "create", "circles", "profile"] as Tab[]).map((tab) => {
            const active = state.tab === tab && !isPushScreen;
            return (
              <button
                key={tab}
                onClick={() => dispatch({ type: "SET_TAB", tab })}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  background: "none", border: "none", cursor: "pointer", padding: "0 4px",
                }}
              >
                {tab === "feed" && <FeedIcon active={active} />}
                {tab === "explore" && <ExploreIcon active={active} />}
                {tab === "create" && <PlusIcon />}
                {tab === "circles" && <CirclesIcon active={active} />}
                {tab === "profile" && <ProfileIcon active={active} />}
                {tab !== "create" && (
                  <span style={{ fontSize: 10, color: active ? "#A855F7" : "rgba(255,255,255,0.3)", fontWeight: active ? 600 : 400 }}>
                    {tab === "feed" ? "Feed" : tab === "explore" ? "Explore" : tab === "circles" ? "Circles" : "Profile"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
