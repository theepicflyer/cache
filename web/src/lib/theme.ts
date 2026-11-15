/** Theme: "system" (default) follows the device; "light" and "dark" stick. app.html sets it before paint. */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'burrow-theme';

export function themeChoice(): ThemeChoice {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved === 'light' || saved === 'dark') return saved;
	} catch {
		/* storage blocked */
	}
	return 'system';
}

export function applyTheme(choice: ThemeChoice): void {
	const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.dataset.theme = dark ? 'wygiwyh_dark' : 'wygiwyh_light';
}

export function setTheme(choice: ThemeChoice): void {
	try {
		localStorage.setItem(KEY, choice);
	} catch {
		/* ignore */
	}
	applyTheme(choice);
}

/** Follow the device while the choice is "system". Returns the function that stops it. */
export function followDevice(): () => void {
	const media = matchMedia('(prefers-color-scheme: dark)');
	const update = () => {
		if (themeChoice() === 'system') applyTheme('system');
	};
	media.addEventListener('change', update);
	return () => media.removeEventListener('change', update);
}
