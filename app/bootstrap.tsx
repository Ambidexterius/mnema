import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './main.tsx';
import { maintainUploadCache } from './api.ts';
import './mnemonika-design.css';
import './mobile.css';

window.addEventListener('vite:preloadError', (event) => {
  if (!navigator.onLine) return;
  try {
    const key = 'mnema.preload-retry';
    if (sessionStorage.getItem(key) === import.meta.url) return;
    sessionStorage.setItem(key, import.meta.url);
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

void maintainUploadCache();
createRoot(document.getElementById('app')!).render(<App />);
