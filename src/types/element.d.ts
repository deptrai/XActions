/// <reference lib="dom" />

/**
 * DOM scraping convenience — these properties are valid on the specific
 * element subtypes the scraper queries (img, a, HTMLElement), but are
 * exposed on the base interface to avoid repetitive casts in page context.
 */
interface Element {
  /** Resolved or attribute href for anchor elements. */
  href?: string;
  /** Resolved or attribute src for media elements. */
  src?: string;
  /** Alt text for media elements. */
  alt?: string;
  /** Rendered visible text for HTMLElement subtypes. */
  innerText?: string;
  /** Programmatic click (available on HTMLElement in page context). */
  click(): void;
  /** Programmatic focus (available on HTMLElement in page context). */
  focus(options?: FocusOptions): void;
}
