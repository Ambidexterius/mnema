import React, { useEffect, useRef, useState } from 'react';
import { useThemeType } from '@gravity-ui/uikit';
import light from './assets/mnemoduck-living/light.svg?raw';
import dark from './assets/mnemoduck-living/dark.svg?raw';

export type MascotMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'puzzled'
  | 'sad'
  | 'surprised'
  | 'love'
  | 'shy'
  | 'angry'
  | 'dizzy'
  | 'sleepy'
  | 'wink';
const POSES: Record<MascotMood, string> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  happy: 'joy',
  puzzled: 'question',
  sad: 'error',
  surprised: 'surprise',
  love: 'love',
  shy: 'calm',
  angry: 'error',
  dizzy: 'error',
  sleepy: 'sleep',
  wink: 'wink',
};
const TRANSIENT: MascotMood[] = ['happy', 'love', 'shy', 'surprised', 'wink'];
const POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';

export default function Mascot({
  mood: asked = 'idle',
  size = 20,
  live = false,
}: {
  mood?: MascotMood;
  size?: number;
  live?: boolean;
}) {
  const theme = useThemeType(),
    host = useRef<HTMLSpanElement>(null),
    svg = useRef<SVGSVGElement>(null),
    gaze = useRef<SVGGElement>(null);
  const [settled, setSettled] = useState(false),
    [sleeping, setSleeping] = useState(false),
    [hovered, setHovered] = useState(false);
  const pose = POSES[settled ? 'idle' : asked];
  useEffect(() => {
    setSettled(false);
    if (!TRANSIENT.includes(asked)) return;
    const timer = setTimeout(() => setSettled(true), 2600);
    return () => clearTimeout(timer);
  }, [asked]);
  useEffect(() => {
    // Isolate the supplied SVG's CSS and gradient IDs from the app and other avatars.
    const shadow = host.current!.shadowRoot || host.current!.attachShadow({ mode: 'open' });
    const phase =
      svg.current?.dataset.phase ||
      (live && size > 20 && !matchMedia(REDUCED).matches ? 'intro' : 'living');
    const node = document.importNode(
      new DOMParser().parseFromString(theme === 'dark' ? dark : light, 'image/svg+xml')
        .documentElement,
      true,
    ) as unknown as SVGSVGElement;
    node.setAttribute('width', String(size));
    node.setAttribute('height', String(size));
    node.style.display = 'block';
    node.dataset.phase = phase;
    const eyes = node.querySelectorAll('.facial>.eyes'),
      look = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    look.classList.add('mascot-gaze');
    eyes[0].before(look);
    look.append(...eyes);
    look.style.transition =
      'transform var(--mn-motion-fast,160ms) var(--mn-ease-out,cubic-bezier(.23,1,.32,1))';
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent =
      '[data-paused] *{animation-play-state:paused!important}@media(prefers-reduced-motion:reduce){g{transition:none!important}}';
    node.append(style);
    shadow.replaceChildren(node);
    svg.current = node;
    gaze.current = look;
    const timer = setTimeout(() => {
      if (node.dataset.phase === 'intro') node.dataset.phase = 'living';
    }, 3000);
    return () => clearTimeout(timer);
  }, [theme, size]);
  useEffect(() => {
    const node = svg.current!;
    node.dataset.state = hovered ? 'love' : sleeping && pose === 'idle' ? 'sleep' : pose;
    if (node.dataset.state === 'sleep') node.dataset.phase = 'sleep';
    else if (node.dataset.phase !== 'intro' || pose !== 'idle' || hovered)
      node.dataset.phase = live || pose !== 'idle' || hovered ? 'living' : 'still';
  }, [pose, hovered, sleeping, theme, size, live]);
  useEffect(() => {
    if (!live) return;
    const reduced = matchMedia(REDUCED),
      pointer = matchMedia(POINTER);
    let timer: ReturnType<typeof setTimeout>,
      frame = 0,
      lastWake = 0;
    const resetGaze = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (gaze.current) gaze.current.style.transform = 'none';
    };
    const wake = () => {
      setSleeping(false);
      clearTimeout(timer);
      if (pose === 'idle')
        timer = setTimeout(() => {
          setSleeping(true);
          resetGaze();
        }, 60000);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !pointer.matches || reduced.matches || document.hidden)
        return;
      if (Date.now() - lastWake > 750) {
        lastWake = Date.now();
        wake();
      }
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = host.current?.getBoundingClientRect();
        if (!rect || !gaze.current) return;
        const x = Math.max(-3, Math.min(3, (event.clientX - rect.left - rect.width / 2) / 80)),
          y = Math.max(-2, Math.min(2, (event.clientY - rect.top - rect.height / 2) / 100));
        gaze.current.style.transform = `translate(${x}px,${y}px)`;
      });
    };
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        resetGaze();
        svg.current?.setAttribute('data-paused', '');
      } else {
        svg.current?.removeAttribute('data-paused');
        wake();
      }
    };
    const mediaChange = () => {
      resetGaze();
      if (!pointer.matches) setHovered(false);
    };
    wake();
    visibility();
    window.addEventListener('pointermove', move, { passive: true });
    for (const event of ['pointerdown', 'keydown', 'input', 'scroll'])
      window.addEventListener(event, wake, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', mediaChange);
    pointer.addEventListener('change', mediaChange);
    return () => {
      clearTimeout(timer);
      resetGaze();
      window.removeEventListener('pointermove', move);
      for (const event of ['pointerdown', 'keydown', 'input', 'scroll'])
        window.removeEventListener(event, wake);
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', mediaChange);
      pointer.removeEventListener('change', mediaChange);
    };
  }, [live, pose]);
  return (
    <span
      ref={host}
      className="mascot"
      data-mood={
        hovered ? 'love' : sleeping && pose === 'idle' ? 'sleepy' : settled ? 'idle' : asked
      }
      data-live={live || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && matchMedia(POINTER).matches) setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
    />
  );
}
