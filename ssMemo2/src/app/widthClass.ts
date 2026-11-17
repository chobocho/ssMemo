// Width classes: the three layouts the app adapts to.
//
// Measured on the target foldable (Samsung Internet, 3.19 device pixel ratio): the unfolded
// viewport is about 580 CSS px (36em) wide and the cover screen about 300 CSS px (19em).
// The medium boundary therefore sits well below 580 px, so the unfolded screen gets the roomier
// layout instead of a stretched phone layout.
//
// Media queries cannot read CSS variables, so src/styles repeats these values; a test keeps the
// two in sync. They are in em so they follow the browser's font-size setting.

export type WidthClass = 'compact' | 'medium' | 'expanded';

export const MEDIUM_MIN_WIDTH_EM = 30;
export const EXPANDED_MIN_WIDTH_EM = 52.5;

export const WIDTH_CLASS_QUERIES = {
  medium: `(min-width: ${MEDIUM_MIN_WIDTH_EM}em)`,
  expanded: `(min-width: ${EXPANDED_MIN_WIDTH_EM}em)`,
} as const;

/** @param matches whether a media query currently matches, e.g. via window.matchMedia. */
export function pickWidthClass(matches: (query: string) => boolean): WidthClass {
  if (matches(WIDTH_CLASS_QUERIES.expanded)) return 'expanded';
  if (matches(WIDTH_CLASS_QUERIES.medium)) return 'medium';
  return 'compact';
}
