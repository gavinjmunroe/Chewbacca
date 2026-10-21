import { ShieldCheck, Shield, Award } from "lucide-react";
import type { VerificationTier } from "@/types/database";
import { TIER_LABELS } from "@/types/database";

interface VerificationBadgeProps {
  tier: VerificationTier;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const TIER_CONFIG = {
  "0": {
    icon: Shield,
    style: {
      background: "rgba(120,120,128,0.2)",
      color: "rgba(235,235,245,0.5)",
      border: "1px solid rgba(84,84,88,0.6)",
    },
    label: TIER_LABELS["0"],
  },
  "1": {
    icon: ShieldCheck,
    style: {
      background: "rgba(94,92,230,0.2)",
      color: "#7B79F7",
      border: "1px solid rgba(94,92,230,0.45)",
    },
    label: TIER_LABELS["1"],
  },
  "2": {
    icon: Award,
    style: {
      background: "linear-gradient(135deg, rgba(255,214,10,0.18) 0%, rgba(255,159,10,0.12) 100%)",
      color: "#FFD60A",
      border: "1px solid rgba(255,214,10,0.35)",
      boxShadow: "0 0 12px rgba(255,214,10,0.2)",
    },
    label: TIER_LABELS["2"],
  },
};

export default function VerificationBadge({
  tier,
  size = "md",
  showLabel = false,
}: VerificationBadgeProps) {
  // Graceful fallback: treat unknown or numeric 0 as tier "0"
  const normalizedTier: VerificationTier =
    (tier === "0" || tier === "1" || tier === "2") ? tier : "0";
  const config = TIER_CONFIG[normalizedTier];
  const Icon = config.icon;

  const iconSize = size === "sm" ? 10 : size === "lg" ? 14 : 12;
  const fontSize = size === "sm" ? 10 : size === "lg" ? 13 : 11;
  const px = size === "sm" ? "6px 8px" : "5px 10px";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 980,
        fontWeight: 700,
        letterSpacing: "0.3px",
        fontSize,
        padding: px,
        whiteSpace: "nowrap",
        ...config.style,
      }}
    >
      <Icon style={{ width: iconSize, height: iconSize, flexShrink: 0 }} />
      {showLabel || normalizedTier === "0" ? config.label : `T${normalizedTier}`}
    </span>
  );
}
