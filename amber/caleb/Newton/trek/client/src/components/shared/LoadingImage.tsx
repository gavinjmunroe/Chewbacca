import React, { useState, type ImgHTMLAttributes } from 'react'

interface LoadingImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  containerClassName?: string
  containerStyle?: React.CSSProperties
}

// Image with shimmer-placeholder until loaded. Drops the shimmer once native load fires.
export function LoadingImage({
  containerClassName, containerStyle, className, style, onLoad, ...imgProps
}: LoadingImageProps): React.ReactElement {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={containerClassName} style={{ position: 'relative', overflow: 'hidden', ...containerStyle }}>
      {!loaded && (
        <div
          className="trek-skeleton"
          style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
          aria-hidden
        />
      )}
      <img
        {...imgProps}
        className={className}
        style={{
          ...style,
          opacity: loaded ? 1 : 0,
          transition: 'opacity 300ms cubic-bezier(0.23, 1, 0.32, 1)',
        }}
        onLoad={e => { setLoaded(true); onLoad?.(e) }}
      />
    </div>
  )
}

export default LoadingImage
