import { useEffect, useState } from "react";
import { File, AlertTriangle, Loader2, Play, X } from "lucide-react";
import type { AttachmentDTO } from "@shared/types";
import { bytesToHuman, cn } from "@/lib/utils";

interface AttachmentViewProps {
  attachment: AttachmentDTO;
  isFromMe: boolean;
}

export function AttachmentView({
  attachment,
  isFromMe,
}: AttachmentViewProps): JSX.Element {
  if (
    attachment.transferStatus === "pending" ||
    attachment.transferStatus === "transferring"
  ) {
    return <PlaceholderTile attachment={attachment} state="loading" />;
  }
  if (attachment.transferStatus === "failed" || !attachment.fileUrl) {
    return <PlaceholderTile attachment={attachment} state="failed" />;
  }
  if (attachment.isImage) {
    return <ImageTile attachment={attachment} />;
  }
  if (attachment.isVideo) {
    return <VideoTile attachment={attachment} />;
  }
  if (attachment.isAudio) {
    return <AudioTile attachment={attachment} />;
  }
  return <FileTile attachment={attachment} isFromMe={isFromMe} />;
}

function ImageTile({ attachment }: { attachment: AttachmentDTO }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    attachment.fileUrl,
  );
  const [lightbox, setLightbox] = useState(false);

  // HEIC/HEIF can't render in Chromium. Ask main to convert via `sips`
  // and swap in the JPEG file:// URL once ready.
  const needsConvert =
    /(heic|heif)/i.test(attachment.mimeType) ||
    /\.(heic|heif)$/i.test(attachment.fileName ?? "");

  useEffect(() => {
    if (!needsConvert || !attachment.localPath) return;
    let cancelled = false;
    window.messages
      .convertHeic(attachment.localPath)
      .then((url) => {
        if (!cancelled && url) setResolvedUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsConvert, attachment.localPath]);

  return (
    <>
      <button
        type="button"
        onClick={() => setLightbox(true)}
        className="group relative block max-w-[260px] overflow-hidden rounded-2xl bg-zinc-800 transition-transform active:scale-[0.99]"
      >
        {!loaded && (
          <div className="absolute inset-0 flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
          </div>
        )}
        <img
          src={resolvedUrl ?? ""}
          alt={attachment.altText || attachment.fileName || "image"}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={cn(
            "block max-h-[420px] w-full object-cover transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
      {lightbox && resolvedUrl && (
        <Lightbox src={resolvedUrl} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

function Lightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt="Full size"
        className="max-h-[92vh] max-w-[92vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function VideoTile({ attachment }: { attachment: AttachmentDTO }): JSX.Element {
  return (
    <div className="relative max-w-[260px] overflow-hidden rounded-2xl bg-black">
      <video
        src={attachment.fileUrl ?? undefined}
        controls
        preload="metadata"
        className="block max-h-[420px] w-full"
      />
    </div>
  );
}

function AudioTile({ attachment }: { attachment: AttachmentDTO }): JSX.Element {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    attachment.fileUrl,
  );
  // iMessage voice messages are .caf (Core Audio Format) which Chromium
  // can't decode. Ask main to convert via macOS-native `afconvert` to
  // AAC-in-MP4 (.m4a) and swap the URL once ready.
  const needsConvert =
    /(audio\/x-caf|audio\/caf)/i.test(attachment.mimeType) ||
    /\.caf$/i.test(attachment.fileName ?? "");
  useEffect(() => {
    if (!needsConvert || !attachment.localPath) return;
    let cancelled = false;
    window.messages
      .convertAudio(attachment.localPath)
      .then((url) => {
        if (!cancelled && url) setResolvedUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsConvert, attachment.localPath]);
  return (
    <div className="flex w-[280px] items-center gap-3 rounded-2xl bg-zinc-800/80 p-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-imessage-blue">
        <Play className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <audio src={resolvedUrl ?? undefined} controls className="w-full" />
      </div>
    </div>
  );
}

function FileTile({
  attachment,
  isFromMe,
}: {
  attachment: AttachmentDTO;
  isFromMe: boolean;
}): JSX.Element {
  return (
    <a
      href={attachment.fileUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group flex max-w-[280px] items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors",
        isFromMe
          ? "bg-blue-600/40 hover:bg-blue-600/60"
          : "bg-zinc-800/70 hover:bg-zinc-700/70",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
        <File className="h-5 w-5 text-white/90" />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-white"
          title={attachment.fileName ?? "File"}
        >
          {attachment.fileName ?? "File"}
        </div>
        <div className="text-xs text-white/60">
          {bytesToHuman(attachment.sizeBytes)}
        </div>
      </div>
    </a>
  );
}

function PlaceholderTile({
  attachment,
  state,
}: {
  attachment: AttachmentDTO;
  state: "loading" | "failed";
}): JSX.Element {
  return (
    <div className="flex w-[260px] items-center gap-3 rounded-2xl bg-zinc-800/60 p-3 text-zinc-300">
      {state === "loading" ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-zinc-400" />
      ) : (
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate">{attachment.fileName ?? "Attachment"}</div>
        <div className="text-xs text-zinc-500">
          {state === "loading" ? "Transferring…" : "Unavailable"}
        </div>
      </div>
    </div>
  );
}
