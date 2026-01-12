import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    base: './',
    root: path.join(__dirname, 'src/renderer'),
    build: {
        outDir: path.join(__dirname, 'dist/renderer'),
        emptyOutDir: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared'),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
