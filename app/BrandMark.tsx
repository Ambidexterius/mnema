import React from 'react';
export default function BrandMark(){return <img className="brand-symbol" src="/brand-mark.svg?v=0.9.3" alt="" aria-hidden="true" width="32" height="32"/>}

/** Бета-значок: круг цвета основного текста (белый в тёмной теме) с «β» цвета фона. Текст для скринридера — у родителя. */
export function BetaMark({size=12}:{size?:number}){return <svg className="beta-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="var(--g-color-text-primary)"/><path d="M9.3 19.6V8.6c0-2.2 1.4-3.6 3.3-3.6 1.8 0 3.1 1.2 3.1 2.9 0 1.3-.8 2.3-2.2 2.6 1.9.2 3.1 1.5 3.1 3.2 0 2-1.6 3.4-3.6 3.4-1.4 0-2.6-.6-3.7-1.6" fill="none" stroke="var(--g-color-base-background)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
