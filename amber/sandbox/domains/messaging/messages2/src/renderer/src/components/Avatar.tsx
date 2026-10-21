import { useState } from "react";
import { avatarColor, initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AvatarProps {
  name: string | null;
  identifier?: string | null;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

export function Avatar({
  name,
  identifier,
  photoUrl,
  size = "md",
  className,
}: AvatarProps): JSX.Element {
  const [photoFailed, setPhotoFailed] = useState(false);
  const seed = name || identifier || "unknown";
  const gradient = avatarColor(seed);
  const label = initials(name, identifier);

  if (photoUrl && !photoFailed) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-full bg-zinc-800",
          SIZES[size],
          className,
        )}
      >
        <img
          src={photoUrl}
          alt={name ?? "Contact"}
          onError={() => setPhotoFailed(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-inner",
        gradient,
        SIZES[size],
        className,
      )}
    >
      {label}
    </div>
  );
}
