import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const server = 'http://localhost:8000';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			// SPA: the server serves index.html for every client-side route.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		proxy: Object.fromEntries(
			['/api', '/auth', '/oauth', '/mcp', '/.well-known'].map((path) => [path, { target: server, changeOrigin: false }])
		)
	}
});
