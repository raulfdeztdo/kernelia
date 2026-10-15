"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

interface ArticleImageProps {
  src: string;
  className?: string;
  priority?: boolean;
  /** Rendered instead of the image when the publisher's URL fails to load. */
  fallback: ReactNode;
}

/**
 * Publisher image for an article, served straight from the publisher's CDN.
 *
 * `unoptimized` on purpose: routing arbitrary publisher images through
 * Vercel's optimiser burned the Hobby quota, and once it ran out every
 * uncached image came back as a 402 and rendered as a broken icon. These
 * images are already web-sized JPEG/PNG/WebP, and `<img>` never executes
 * script inside an SVG, so the proxy bought us little.
 *
 * Publisher URLs also rot (hotlink protection, deleted uploads, http-only
 * hosts), so a failed load swaps in `fallback` instead of a broken image.
 * `next/image` re-fires `onError` after hydration for images that failed
 * during SSR, so this also covers errors that happen before React mounts.
 */
export function ArticleImage({ src, className, priority, fallback }: ArticleImageProps) {
  // Keyed by `src` so a card reused for another article retries its image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) return <>{fallback}</>;

  return (
    <Image
      src={src}
      alt=""
      fill
      unoptimized
      priority={priority}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
