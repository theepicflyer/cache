// The Django version of Cache registered a service worker at this address. Browsers that still
// have it fetch this file when they check for updates; this one clears its caches and removes
// itself, so those phones load the new app straight from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((n) => n.startsWith('django-pwa-')).map((n) => caches.delete(n)));
			await self.registration.unregister();
			const pages = await self.clients.matchAll({ type: 'window' });
			for (const page of pages) page.navigate(page.url);
		})()
	);
});
