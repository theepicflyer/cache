/**
 * Cache's own motion, on top of warren/web's: whether the screen on show arrived by going back (its
 * entrances then stay still), in-page changes of data (another month, another span), and disclosures
 * that open and close smoothly. Everything stands still under reduced motion.
 */
import { prefersReducedMotion } from 'svelte/motion';

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * Whether the screen on show was reached by going back (Warren's `arrivedBy()`), applied by the root
 * layout as the screen mounts and kept until the next screen: a screen gone back to is drawn as it
 * was left, so nothing on it rises, fills or draws again (the layout marks `main` with `is-back`,
 * which the motion CSS reads).
 */
export const arrival = $state({ back: false });

/** No motion at all: reduced motion, or a screen gone back to. */
export const still = () => prefersReducedMotion.current || arrival.back;

/**
 * The same screen showing other data: the content slides in from the side it came from (`dir` 1
 * from the right, for later; -1 from the left, for earlier), or cross-fades (`dir` 0).
 */
export function settle(elements: (Element | null | undefined)[], dir: -1 | 0 | 1): void {
	if (prefersReducedMotion.current) return;
	const from = dir ? { opacity: 0, transform: `translateX(${dir * 32}px)` } : { opacity: 0.2 };
	for (const el of elements) {
		el?.animate([from, { opacity: 1, transform: 'none' }], { duration: dir ? 320 : 240, easing: EASE });
	}
}

/**
 * An attachment for a `<details>`: it opens and closes by growing and shrinking rather than at once.
 * Works with `bind:open`, since it toggles `open` itself and the element fires `toggle`.
 */
export function smoothDetails(details: HTMLDetailsElement) {
	const summary = details.querySelector<HTMLElement>(':scope > summary');
	if (!summary) return;
	let running: Animation | null = null;
	let closing = false;

	const onclick = (e: MouseEvent) => {
		if (prefersReducedMotion.current) return;
		e.preventDefault();
		const start = details.offsetHeight;
		running?.cancel();
		details.style.overflow = 'clip';
		const opening = !details.open || closing;
		if (opening) {
			closing = false;
			details.open = true;
		} else {
			closing = true;
		}
		const end = opening ? details.offsetHeight : summary.offsetHeight;
		running = details.animate({ height: [`${start}px`, `${end}px`] }, { duration: opening ? 280 : 200, easing: EASE });
		running.onfinish = () => {
			if (closing) details.open = false;
			closing = false;
			running = null;
			details.style.overflow = '';
		};
	};
	summary.addEventListener('click', onclick);
	return () => summary.removeEventListener('click', onclick);
}
