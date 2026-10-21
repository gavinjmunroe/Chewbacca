"use client";

import { useReducer, useCallback, useRef, TouchEvent } from "react";
import { Screen } from "@/types";

interface AppState {
  screen: Screen;
  direction: "forward" | "back";
  storyId: string | undefined;
  animKey: number;
  posted: boolean;
}

type AppAction =
  | { type: "NAVIGATE"; screen: Screen; direction: "forward" | "back"; storyId: string | undefined }
  | { type: "SET_POSTED" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        screen: action.screen,
        direction: action.direction,
        storyId: action.storyId,
        animKey: state.animKey + 1,
      };
    case "SET_POSTED":
      return { ...state, posted: true };
    default:
      return state;
  }
}

import BottomNav             from "@/components/BottomNav";
import SplashScreen          from "@/screens/SplashScreen";
import VerifyScreen          from "@/screens/VerifyScreen";
import HomeScreen            from "@/screens/HomeScreen";
import PromptScreen          from "@/screens/PromptScreen";
import ComposeScreen         from "@/screens/ComposeScreen";
import FeedScreen            from "@/screens/FeedScreen";
import StoryCardScreen       from "@/screens/StoryCardScreen";
import DiscoveryScreen       from "@/screens/DiscoveryScreen";
import ProfileScreen         from "@/screens/ProfileScreen";
import NotificationsScreen   from "@/screens/NotificationsScreen";
import SettingsScreen        from "@/screens/SettingsScreen";
import CircleManageScreen    from "@/screens/CircleManageScreen";
import UserProfileScreen     from "@/screens/UserProfileScreen";

export default function AppShell() {
  const [state, dispatch] = useReducer(appReducer, {
    screen: "splash" as Screen,
    direction: "forward" as "forward" | "back",
    storyId: undefined,
    animKey: 0,
    posted: false,
  });

  const { screen, direction, storyId, animKey, posted } = state;

  const screenRef     = useRef<Screen>("splash");
  const prevScreenRef = useRef<Screen>("home");
  const touchStartX   = useRef<number>(0);

  const navigate = useCallback((next: Screen, dir: "forward" | "back" = "forward", sid?: string) => {
    if (dir !== "back") prevScreenRef.current = screenRef.current;
    screenRef.current = next;
    dispatch({ type: "NAVIGATE", screen: next, direction: dir, storyId: sid });
  }, []);

  const goBack = useCallback(() => {
    const rootScreens: Screen[] = ["home", "splash", "verify"];
    if (rootScreens.includes(screenRef.current)) return;
    navigate(prevScreenRef.current, "back");
  }, [navigate]);

  const navigateWithStory = useCallback((next: Screen, dir: "forward" | "back" = "forward", sid?: string) => {
    if (next === "story") {
      navigate(next, dir, sid ?? storyId ?? "marcus-1");
    } else {
      navigate(next, dir, sid);
    }
  }, [navigate, storyId]);

  const animClass = direction === "forward" ? "screen-forward" : "screen-back";

  const rootScreens: Screen[] = ["splash", "verify", "home"];

  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (rootScreens.includes(screenRef.current)) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta > 80 && direction !== "back") {
      goBack();
    }
  }, [direction, goBack]);

  const onPost = useCallback(() => {
    dispatch({ type: "SET_POSTED" });
    navigateWithStory("home", "forward");
  }, [navigateWithStory]);

  const navActive = (
    screen === "discovery"    ? "discovery" :
    screen === "profile"      ? "profile"   :
    screen === "settings"     ? "profile"   :
    screen === "circle-manage"? "profile"   :
    screen === "compose"      ? "compose"   :
    "home"
  ) as "home" | "compose" | "discovery" | "profile";

  const sharedProps = {
    navigate: (s: Screen, d?: "forward" | "back", sid?: string) => navigateWithStory(s, d, sid),
    goBack,
    storyId,
    posted,
    onPost,
    navActive,
  };

  const showNav = !["splash", "verify", "compose", "notifications", "settings", "circle-manage", "user-profile"].includes(screen);

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#0f0c0a",
      position: "relative", overflow: "hidden",
      fontFamily: "var(--font-inter), system-ui, sans-serif",
    }}>
      <div
        key={animKey}
        className={animClass}
        style={{ width: "100%", height: "100%" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {screen === "splash"        && <SplashScreen         {...sharedProps} />}
        {screen === "verify"        && <VerifyScreen         {...sharedProps} />}
        {screen === "home"          && <HomeScreen           {...sharedProps} />}
        {screen === "prompt"        && <PromptScreen         {...sharedProps} />}
        {screen === "compose"       && <ComposeScreen        {...sharedProps} />}
        {screen === "feed"          && <FeedScreen           {...sharedProps} />}
        {screen === "story"         && <StoryCardScreen      {...sharedProps} />}
        {screen === "discovery"     && <DiscoveryScreen      {...sharedProps} />}
        {screen === "profile"       && <ProfileScreen        {...sharedProps} />}
        {screen === "notifications" && <NotificationsScreen  {...sharedProps} />}
        {screen === "settings"      && <SettingsScreen       {...sharedProps} />}
        {screen === "circle-manage" && <CircleManageScreen   {...sharedProps} />}
        {screen === "user-profile"  && <UserProfileScreen    {...sharedProps} />}
      </div>
      {/* Always in the DOM — no mount/unmount, no animation */}
      <div style={{ visibility: showNav ? "visible" : "hidden" }}>
        <BottomNav active={navActive} navigate={(s, d) => navigateWithStory(s, d)} />
      </div>
    </div>
  );
}
