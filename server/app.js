/**
 * app.js — Express App Factory
 *
 * Configura middlewares globales, static files y exporta la app.
 * No incluye rutas API ni WebSocket (se montan desde server.js).
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { __dirname } from './config.js';

const app = express();

// ─── Middlewares globales ───
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// ─── Body-parser error handler ───
// Atrapa SyntaxError de JSON malformado (acentos corruptos por encoding de Windows)
// y devuelve un error 400 claro en vez de que el worker se quede esperando.
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const preview = String(err.body || '').slice(0, 200).replace(/[^\x20-\x7E]/g, '?');
        console.error(`[BODY-PARSER] ⚠️ JSON inválido en ${req.method} ${req.url}`);
        console.error(`[BODY-PARSER]    Preview: ${preview}...`);
        console.error(`[BODY-PARSER]    Error: ${err.message}`);
        return res.status(400).json({ error: 'JSON malformado en el body de la solicitud', detail: err.message });
    }
    next(err);
});

// ─── Global error handler middleware ───
// Captura errores no manejados en rutas y devuelve 500 limpio.
// Elimina la necesidad de try-catch en cada ruta.
app.use((err, req, res, next) => {
    console.error(`[SERVER] ⚠️ Error en ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
    }
});

// ─── Servir archivos estáticos ───
// Ruta /static → raíz del proyecto
app.use('/static', express.static(path.join(__dirname, '.')));

// Frontend desde public/
app.use(express.static(path.join(__dirname, 'public')));

// Redirigir raíz al index.html del frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Imágenes temporales para Hermes (vision_analyze)
const tempImagesDir = path.join(__dirname, 'temp_images');
app.use('/temp-images', express.static(tempImagesDir));

// ─── Request Logger — solo para non-polling endpoints ───
app.use((req, res, next) => {
    if (req.headers['x-silent-check']) return next();
    // No loggear polling interno
    if (req.url && (req.url.startsWith('/api/hermes/logs/') || req.url.includes('/logs/'))) return next();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

export default app;
