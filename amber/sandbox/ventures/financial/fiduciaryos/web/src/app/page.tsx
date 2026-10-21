import type { Metadata } from "next";
import FiduciaryOSClient from "./FiduciaryOSClient";

export const metadata: Metadata = {
  title: "FiduciaryOS — Fiduciary-Grade Autonomous Wealth Management",
  description:
    "The first wealth management AI built for fiduciary compliance. Every decision verified against a signed policy artifact, logged with a replayable audit trail, and kill-switchable in milliseconds.",
  openGraph: {
    title: "FiduciaryOS — Fiduciary-Grade Autonomous Wealth Management",
    description:
      "Autonomous wealth management AI. Policy-compiled constraints, household after-tax optimization, and full audit replay.",
    type: "website",
  },
};

export default function FiduciaryOSPage() {
  return <FiduciaryOSClient />;
}
