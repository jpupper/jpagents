/**
 * social-publisher.js — Motor de publicación multiplataforma
 * 
 * Plataformas soportadas:
 * - Instagram (Meta Graph API)
 * - Facebook (Meta Graph API)
 * - Artedigitaldata (API REST propia)
 * - RedNote / Xiaohongshu (documentación, pendiente API oficial)
 * 
 * Configuración: las credenciales se almacenan en
 * ~/.hermes/social-credentials.json y se cargan al iniciar.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';

const CREDENTIALS_PATH = path.join(os.homedir(), '.hermes', 'social-credentials.json');

// ─── Gestión de credenciales ───

async function loadCredentials() {
    try {
        const data = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveCredentials(credentials) {
    await fs.mkdir(path.dirname(CREDENTIALS_PATH), { recursive: true });
    await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), 'utf-8');
}

// ─── Meta (Instagram + Facebook) ───

/**
 * Publicar en Facebook Page usando Meta Graph API v22.0
 * @param {object} creds - { pageId, pageAccessToken }
 * @param {object} content - { message, imageUrl?, link? }
 */
async function publishFacebook(creds, content) {
    const { pageId, pageAccessToken } = creds;
    if (!pageId || !pageAccessToken) {
        throw new Error('Facebook: falta pageId o pageAccessToken. Configurá las credenciales primero.');
    }

    const apiVersion = 'v22.0';
    const base = `https://graph.facebook.com/${apiVersion}/${pageId}`;

    if (content.imageUrl) {
        // Publicar con imagen
        const response = await fetch(`${base}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: content.imageUrl,
                message: content.message || '',
                access_token: pageAccessToken
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(`Facebook error: ${data.error.message}`);
        return { platform: 'facebook', id: data.id, postId: data.id, url: `https://facebook.com/${pageId}/posts/${data.id}` };
    }

    // Publicar solo texto
    const response = await fetch(`${base}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: content.message || '',
            link: content.link || undefined,
            access_token: pageAccessToken
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(`Facebook error: ${data.error.message}`);
    return { platform: 'facebook', id: data.id, postId: data.id, url: `https://facebook.com/${pageId}/posts/${data.id}` };
}

/**
 * Publicar en Instagram (Business/ Creator Account via Graph API)
 * Requiere: Instagram Business Account conectada a Facebook Page
 * @param {object} creds - { igUserId, pageAccessToken }
 * @param {object} content - { caption, imageUrl, videoUrl? }
 */
async function publishInstagram(creds, content) {
    const { igUserId, pageAccessToken } = creds;
    if (!igUserId || !pageAccessToken) {
        throw new Error('Instagram: falta igUserId o pageAccessToken. Configurá las credenciales primero.');
    }

    const apiVersion = 'v22.0';
    const base = `https://graph.facebook.com/${apiVersion}/${igUserId}`;

    // Paso 1: Crear media container
    let mediaEndpoint, mediaBody;
    if (content.videoUrl) {
        mediaEndpoint = `${base}/media`;
        mediaBody = {
            media_type: 'REELS',
            video_url: content.videoUrl,
            caption: content.caption || '',
            access_token: pageAccessToken
        };
    } else if (content.imageUrl) {
        mediaEndpoint = `${base}/media`;
        mediaBody = {
            image_url: content.imageUrl,
            caption: content.caption || '',
            access_token: pageAccessToken
        };
    } else {
        // Instagram no soporta solo texto — usamos imagen placeholder o carrusel
        // Por ahora lanzamos error
        throw new Error('Instagram requiere image_url o video_url');
    }

    const createRes = await fetch(mediaEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mediaBody)
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Instagram error (create media): ${createData.error.message}`);

    const containerId = createData.id;

    // Paso 2: Esperar a que el container esté listo (poll)
    let attempts = 0;
    const maxAttempts = 12;
    while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`${base}/media/${containerId}?fields=status_code,status&access_token=${pageAccessToken}`);
        const statusData = await statusRes.json();
        if (statusData.status_code === 'FINISHED' || statusData.status_code === 'PUBLISHED') break;
        if (statusData.status_code === 'ERROR') {
            throw new Error(`Instagram error: container ${containerId} failed - ${statusData.status || 'unknown'}`);
        }
        attempts++;
    }

    // Paso 3: Publicar el container
    const publishRes = await fetch(`${base}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            creation_id: containerId,
            access_token: pageAccessToken
        })
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`Instagram error (publish): ${publishData.error.message}`);

    return {
        platform: 'instagram',
        id: publishData.id,
        mediaId: publishData.id,
        url: `https://instagram.com/p/${publishData.id}/`
    };
}

// ─── Artedigitaldata ───

/**
 * Publicar en Artedigitaldata (API REST propia)
 * @param {object} creds - { baseUrl, jwtToken }
 * @param {object} content - { titulo, descripcion, imagenUrl?, tags?, tipo ('post'|'recurso'|'evento'), url? }
 */
async function publishArtedigitaldata(creds, content) {
    const { baseUrl, jwtToken } = creds;
    if (!baseUrl || !jwtToken) {
        throw new Error('Artedigitaldata: falta baseUrl o jwtToken. Configurá las credenciales primero.');
    }

    const apiUrl = baseUrl.replace(/\/+$/, '');
    
    // Login primero para obtener token fresco (si tenemos user/pass)
    let token = jwtToken;

    if (content.tipo === 'recurso') {
        // POST /api/recursos
        const response = await fetch(`${apiUrl}/api/recursos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                title: content.titulo,
                description: content.descripcion || '',
                url: content.url || content.imagenUrl || '',
                imageUrl: content.imagenUrl || '',
                tags: content.tags || [],
                type: content.type || 'other',
                source: 'ia',
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(`Artedigitaldata error: ${data.error}`);
        return {
            platform: 'artedigitaldata',
            tipo: 'recurso',
            id: data._id,
            url: `${apiUrl}/${data._id}`
        };
    }

    // Default: POST /api/posts
    const response = await fetch(`${apiUrl}/api/posts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            title: content.titulo,
            description: content.descripcion || '',
            imageUrl: content.imagenUrl || '',
            tags: content.tags || [],
            source: 'ia',
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(`Artedigitaldata error: ${data.error}`);
    return {
        platform: 'artedigitaldata',
        tipo: 'post',
        id: data._id,
        url: `${apiUrl}/${data._id}`
    };
}

// ─── RedNote (小红书) ───

/**
 * RedNote / Xiaohongshu
 * 
 * ⚠️ Xiaohongshu NO tiene API pública para creadores internacionales.
 * Opciones realistas:
 * 1. Programa de socios oficial (solo China, requiere empresa registrada)
 * 2. Herramientas third-party como Newrank, ChanData (solo monitoreo, no publican)
 * 3. Automatización con Playwright/Puppeteer (riesgo de ban, TOS violation)
 * 4. Publicación manual semi-asistida (el agente prepara el contenido,
 *    el usuario lo copia y pega manualmente en RedNote)
 * 
 * Por ahora implementamos modo "asistido": el agente prepara el contenido
 * formateado para RedNote y lo entrega al usuario para publicación manual.
 */
async function publishRedNote(creds, content) {
    // RedNote no tiene API pública usable
    return {
        platform: 'rednote',
        status: 'asistido',
        mensaje: '🧧 RedNote no expone API pública. Se generó el contenido listo para copiar/pegar manualmente.',
        contenidoPreparado: {
            titulo: content.titulo || '',
            descripcion: content.descripcion || '',
            hashtags: (content.tags || []).map(t => `#${t}`).join(' '),
            imagenUrl: content.imagenUrl || '',
        },
        instrucciones: '1. Abrí la app de RedNote (小红书)\n2. Tocá el botón "+" para nueva publicación\n3. Pegá el texto\n4. Subí la imagen\n5. Publicá manualmente'
    };
}

// ─── Publicador unificado ───

const PLATFORM_DETAILS = {
    instagram: {
        name: 'Instagram',
        icon: '📸',
        description: 'Meta Graph API (requiere Instagram Business/Creator Account)',
        requires: ['igUserId', 'pageAccessToken'],
        setupGuide: 'https://developers.facebook.com/docs/instagram-api/getting-started'
    },
    facebook: {
        name: 'Facebook',
        icon: '👍',
        description: 'Meta Graph API (requiere Facebook Page)',
        requires: ['pageId', 'pageAccessToken'],
        setupGuide: 'https://developers.facebook.com/docs/pages/getting-started'
    },
    artedigitaldata: {
        name: 'Artedigitaldata',
        icon: '🎨',
        description: 'API REST de Artedigitaldata.com',
        requires: ['baseUrl', 'jwtToken'],
    },
    rednote: {
        name: 'RedNote / 小红书',
        icon: '🧧',
        description: 'Modo asistido (no hay API pública)',
        requires: [],
        notas: 'Solo preparación de contenido para publicación manual'
    }
};

/**
 * Adaptar contenido genérico al formato de cada plataforma
 * Toma contenido con campos genéricos (titulo, descripcion, message, imageUrl, tags)
 * y lo mapea a los campos específicos de cada plataforma
 */
function adaptContent(platform, contenido) {
    const base = { ...contenido };

    switch (platform) {
        case 'facebook':
            return {
                message: base.message || base.descripcion || base.titulo || '',
                imageUrl: base.imageUrl || base.imagenUrl || base.image_url || null,
                link: base.link || base.url || null
            };

        case 'instagram':
            return {
                caption: base.caption || base.descripcion || base.message || base.titulo || '',
                imageUrl: base.imageUrl || base.imagenUrl || base.image_url || null,
                videoUrl: base.videoUrl || base.video_url || null
            };

        case 'artedigitaldata':
            return {
                titulo: base.titulo || base.title || base.message || '',
                descripcion: base.descripcion || base.description || base.message || '',
                imagenUrl: base.imagenUrl || base.imageUrl || base.image_url || '',
                tags: base.tags || base.hashtags || [],
                tipo: base.tipo || 'post',
                url: base.url || base.link || ''
            };

        case 'rednote':
            return {
                titulo: base.titulo || base.title || '',
                descripcion: base.descripcion || base.description || base.message || '',
                tags: base.tags || base.hashtags || [],
                imagenUrl: base.imagenUrl || base.imageUrl || base.image_url || ''
            };

        default:
            return base;
    }
}

/**
 * Publicar en múltiples plataformas con adaptación automática de contenido
 */
async function publishMultiple({ plataformas, contenido, contenidoPorPlataforma, credenciales } = {}) {
    if (!plataformas || !Array.isArray(plataformas) || plataformas.length === 0) {
        throw new Error('Se requiere "plataformas" como array de strings');
    }
    if (!contenido) {
        throw new Error('Se requiere "contenido"');
    }

    const results = [];

    for (const platform of plataformas) {
        try {
            // Si hay contenido específico para esta plataforma, merge con el base
            const platformOverrides = contenidoPorPlataforma?.[platform] || {};
            const rawContent = { ...contenido, ...platformOverrides };

            // Adaptar el contenido al formato de la plataforma
            const adaptedContent = adaptContent(platform, rawContent);

            const result = await publish({ plataforma: platform, contenido: adaptedContent, credenciales });
            results.push({ plataforma: platform, success: true, result });
        } catch (e) {
            results.push({ plataforma: platform, success: false, error: e.message });
        }
    }

    const totalOk = results.filter(r => r.success).length;
    const totalErr = results.filter(r => !r.success).length;

    return {
        success: totalErr === 0,
        partial: totalErr > 0 && totalOk > 0,
        resultados: results,
        resumen: `${totalOk} publicada(s), ${totalErr} con error`
    };
}

// ─── Endpoint unificado de publicación ───
async function publish({ plataforma, contenido, credenciales } = {}) {
    if (!plataforma || !contenido) {
        throw new Error('Se requiere "plataforma" y "contenido"');
    }

    const platform = plataforma.toLowerCase();
    if (!PLATFORM_DETAILS[platform]) {
        throw new Error(`Plataforma no soportada: "${plataforma}". Soporte: ${Object.keys(PLATFORM_DETAILS).join(', ')}`);
    }

    // Cargar credenciales (se pueden sobrescribir con las pasadas en la request)
    let savedCreds = await loadCredentials();
    const creds = { ...(savedCreds[platform] || {}), ...(credenciales || {}) };

    switch (platform) {
        case 'facebook':
            return await publishFacebook(creds, contenido);
        case 'instagram':
            return await publishInstagram(creds, contenido);
        case 'artedigitaldata':
            return await publishArtedigitaldata(creds, contenido);
        case 'rednote':
            return await publishRedNote(creds, contenido);
        default:
            throw new Error(`Plataforma no implementada: ${platform}`);
    }
}

/**
 * Obtener información de una plataforma
 */
function getPlatformInfo(plataforma) {
    return PLATFORM_DETAILS[plataforma?.toLowerCase()] || null;
}

function getPlatforms() {
    return Object.entries(PLATFORM_DETAILS).map(([key, val]) => ({
        id: key,
        ...val
    }));
}

export default {
    publish,
    publishMultiple,
    adaptContent,
    loadCredentials,
    saveCredentials,
    getPlatformInfo,
    getPlatforms,
    PLATFORM_DETAILS,
    CREDENTIALS_PATH
};
