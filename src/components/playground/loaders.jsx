// loaders.jsx — faithful ports of the playground's loaders.
//   ShortLogoIcon     — the exact OnDemand "O" mark SVG (playground components/Icons)
//   SpinningLogo      — the generating loader: ShortLogoIcon spinning (1.5s linear) while
//                       toggling green<->gray every 1s (playground components/Loader)
//   ShimmerText       — shimmer status text (playground animate-shine)
import React, { useEffect, useState } from 'react';

/** The exact OnDemand mark from the playground (components/Icons ShortLogoIcon). */
export function ShortLogoIcon({ size = 18, className = '' }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 35 36" fill="none" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd"
        d="M17.2396 3.09587C9.20376 3.23614 2.80593 10.0227 2.94961 18.2541C3.06977 25.1382 7.72785 30.8545 13.951 32.4575L14.6751 32.6117L14.5671 35.3137L13.3297 34.9952C6.01557 33.1093 0.537916 26.3934 0.396621 18.2986C0.227733 8.62304 7.74823 0.645636 17.194 0.48076C26.6397 0.315884 34.434 8.02597 34.6029 17.7016C34.7718 27.3772 27.2513 35.3546 17.8056 35.5194L16.5291 35.5417L16.1019 11.0683L18.6549 11.0238L19.0355 32.8264C26.4626 32.0341 32.1859 25.5374 32.05 17.7477C31.9063 9.51472 25.2755 2.9556 17.2396 3.09587Z"
        fill="currentColor" />
    </svg>
  );
}

/**
 * The playground's generating loader (components/Loader): the OnDemand mark spinning at
 * 1.5s linear, its colour toggling between the brand green and a neutral gray every second.
 */
export function SpinningLogo({ size = 18, className = '' }) {
  const [neutral, setNeutral] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNeutral(p => !p), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={`pgspin ${neutral ? 'pgspin--neutral' : ''} ${className}`} aria-label="Generating" role="img">
      <ShortLogoIcon size={size} />
    </span>
  );
}

/** Shimmering status text — the playground's "Suggesting agents..." shine. */
export function ShimmerText({ children, className = '' }) {
  return <span className={`pgloader-shimmer ${className}`}>{children}</span>;
}
