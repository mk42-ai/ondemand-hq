import React from 'react';

/** SVG country flag via the flag-icons library (fi fi-{iso2} classes).
 *  Replaces all emoji flags — crisp SVG rendering on every platform. */
export default function Flag({ iso, size = 'md', title }) {
  if (!iso) return null;
  return (
    <span
      className={`fi fi-${iso.toLowerCase()} igflag igflag--${size}`}
      role="img"
      aria-label={title || `${iso} flag`}
      title={title}
    />
  );
}
