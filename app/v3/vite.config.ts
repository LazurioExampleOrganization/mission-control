import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const LOCAL_NODE_MODULES = new URL('./node_modules/', import.meta.url);
const ROOT_NODE_MODULES = new URL('../../node_modules/', import.meta.url);

function nodeModulePath(modulePath: string): string {
	const localPath = fileURLToPath(new URL(modulePath, LOCAL_NODE_MODULES));
	if (existsSync(localPath)) return localPath;
	return fileURLToPath(new URL(modulePath, ROOT_NODE_MODULES));
}

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			react: nodeModulePath('react'),
			'react/jsx-runtime': nodeModulePath('react/jsx-runtime.js'),
			'react-dom': nodeModulePath('react-dom'),
		},
		dedupe: ['react', 'react-dom'],
	},
	optimizeDeps: {
		include: ['react', 'react/jsx-runtime', 'react-dom', 'yaml'],
	},
});
