import Link from "next/link";
import { ScrollClipStage } from "@/components/ScrollClipStage";
import "./scroll.css";

// The site itself: a scroll-scrubbed geode that morphs into the specimen row,
// then hands over to the waitlist sheet. Title, description and robots all come
// from the root layout, which is already indexable, so nothing is overridden
// here. The plain waitlist page this replaced still exists at /waitlist as a
// fallback for anyone the scrub does not serve.

export default function Page() {
  return (
    <div className="scroll-page">
      {/*
        The way in, for people who already have the app. Fixed rather than in
        the scroll flow, because the page below it is a scrubbed animation and
        anything inside it moves with the geode.
      */}
      <Link
        href="/login"
        className="amber-signin fixed right-6 top-5 z-50"
      >
        Sign in
      </Link>
      <ScrollClipStage />
    </div>
  );
}
