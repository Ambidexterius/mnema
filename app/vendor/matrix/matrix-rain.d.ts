type RainOptions = Partial<{
  color: string;
  glowColor: string;
  fontSize: number;
  lineHeight: number;
  density: number;
  interval: number;
  speed: number;
  opacity: number;
  mask: boolean;
  radius: number;
  glowBrightness: number;
  characters: string;
}>;

export function createRain(canvas: HTMLCanvasElement, options?: RainOptions): { destroy(): void };
