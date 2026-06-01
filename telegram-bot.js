/**
 * telegram-bot.js — Bot de Telegram para JP Agents
 * 
 * Permite:
 * - Listar proyectos y agentes activos
 * - Iniciar/detener agentes Hermes desde Telegram
 * - Recibir notificaciones cuando agentes terminan tareas
 * - Monitorear el sistema completo desde el celular
 * 
 * Comandos:
 * /start    - Bienvenida y estado general
 * /agentes  - Listar todos los agentes con estado
 * /proyectos - Listar proyectos
 * /iniciar  - Iniciar un agente Hermes
 * /detener  - Detener un agente Hermes
 * /status   - Estado del sistema (Ollama, server, agentes)
 * /broadcast - Enviar mensaje a todos los agentes activos
 * /mensaje  - Enviar mensaje a un agente específico
 * /help     - Mostrar todos los comandos
 */

import { Bot, InlineKeyboard } from 'grammy';
import os from 'os';
import path from 'path';

// ─── Configuración ───
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN.length < 40) {
    console.error('[TELEGRAM] ❌ TELEGRAM_BOT_TOKEN no configurado o inválido en .env');
}

// IDs de Telegram autorizados (el dueño del bot)
const AUTHORIZED_USERS = (process.env.TELEGRAM_AUTHORIZED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id));

// Si no hay usuarios autorizados explícitos, el primero que hable es el dueño
let ownerChatId = null;
let ownerSet = false;

// Referencias inyectadas desde server.js
let hermesBridge = null;
let loadSessionsFn = null;

// ─── Helpers ───
const EMOJI = {
    agent: '🤖',
    project: '📁',
    running: '🟢',
    idle: '🟡',
    stopped: '🔴',
    thinking: '💭',
    done: '✅',
    error: '❌',
    folder: '📂',
    message: '💬',
    model: '🧠',
    token: '🪙',
    clock: '🕐',
    warn: '⚠️',
    ollama: '🦙',
    server: '🖥️',
    status: '📊',
    chat: '💬',
    skill: '📋',
};

function isAuthorized(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return false;
    if (AUTHORIZED_USERS.length > 0) {
        return AUTHORIZED_USERS.includes(userId);
    }
    // Si no hay lista explícita, el dueño es quien configuró el bot
    if (ownerChatId && ownerSet) {
        return userId === ownerChatId;
    }
    // Primera persona que habla = dueño
    ownerChatId = userId;
    ownerSet = true;
    console.log(`[TELEGRAM] Dueño del bot registrado: ${ctx.from?.first_name || 'Usuario'} (ID: ${userId})`);
    return true;
}

function formatAgentName(inst) {
    const name = inst.name || `Agente ${inst.chatId?.slice(0, 8) || inst.id?.slice(0, 8)}`;
    return name;
}

function statusEmoji(status) {
    switch (status) {
        case 'running': return EMOJI.running;
        case 'idle': return EMOJI.idle;
        case 'stopped': return EMOJI.stopped;
        default: return '⚪';
    }
}

// ─── Bot ───
const bot = new Bot(BOT_TOKEN);

// ─── Middleware de autorización ───
bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx)) {
        console.warn(`[TELEGRAM] Acceso denegado para ${ctx.from?.first_name} (ID: ${ctx.from?.id})`);
        await ctx.reply('⛔ No estás autorizado para usar este bot.');
        return;
    }
    await next();
});

// ─── Comandos ───

bot.command('start', async (ctx) => {
    const sessions = await loadSessions();
    const projectCount = sessions.projects?.length || 0;
    const bridgeInstances = hermesBridge.listInstances();
    const runningCount = bridgeInstances.filter(i => i.status === 'running').length;
    
    let msg = [
        `${EMOJI.agent} *JP AGENTS — Bot de Control*`,
        '',
        `Bienvenido al centro de control de tus agentes.`,
        '',
        `📊 *Estado actual:*`,
        `   ${EMOJI.project} Proyectos: *${projectCount}*`,
        `   ${EMOJI.agent} Agentes Hermes: *${bridgeInstances.length}* (${runningCount} en ejecución)`,
        '',
        `Usá los botones de abajo o /help para ver todos los comandos.`,
    ].join('\n');

    const keyboard = new InlineKeyboard()
        .text('📊 Status', 'cmd:status').text('🤖 Agentes', 'cmd:agentes')
        .row()
        .text('📁 Proyectos', 'cmd:proyectos').text('🕐 Recientes', 'cmd:recientes');

    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
});

bot.command('help', async (ctx) => {
    let msg = [
        `${EMOJI.agent} *COMANDOS JP AGENTS / HERMES ADMIN*`,
        '',
        `🤖 *Hermes ADMIN:* Cualquier texto que escribas va a Hermes con skill BOTADMIN.`,
        `   Podés pedir lo que sea: preguntas, control del sistema, delegar tareas.`,
        '',
        `${EMOJI.status} */status* — Estado del sistema`,
        `${EMOJI.project} */proyectos* — Listar proyectos`,
        `${EMOJI.agent} */agentes* — Listar todos los agentes`,
        `${EMOJI.running} */iniciar <carpeta>* — Iniciar agente en carpeta`,
        `${EMOJI.stopped} */detener <projectId>* — Detener agente`,
        `${EMOJI.chat} */chat <projectId> <texto>* — Chatear con agente`,
        `${EMOJI.message} */broadcast <texto>* — Enviar a todos`,
        `${EMOJI.clock} */recientes* — Agentes recientes`,
        `${EMOJI.skill} */logs <projectId>* — Ver logs del agente`,
        '',
        `📝 *Ejemplos de uso libre:*`,
        `   "Mostrame el estado del sistema"`,
        `   "Mandale a AgenteX que revise el codigo"`,
        `   "Prendé JP Agents"`,
        `   "Crea un proyecto nuevo llamado test"`,
        '',
        `También podés responder a cualquier mensaje del bot para seguir la conversación.`,
    ].join('\n');
    
    // Inline keyboard con accesos rápidos
    const keyboard = new InlineKeyboard()
        .text('📊 Status', 'cmd:status').text('🤖 Agentes', 'cmd:agentes')
        .row()
        .text('📁 Proyectos', 'cmd:proyectos').text('🕐 Recientes', 'cmd:recientes');
    
    await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// ─── Manejar callbacks del teclado inline ───
bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    
    // Simular el comando correspondiente
    if (data === 'cmd:status') {
        ctx.message = { text: '/status' };
        await bot.command('status')(ctx);
    } else if (data === 'cmd:agentes') {
        ctx.message = { text: '/agentes' };
        await bot.command('agentes')(ctx);
    } else if (data === 'cmd:proyectos') {
        ctx.message = { text: '/proyectos' };
        await bot.command('proyectos')(ctx);
    } else if (data === 'cmd:recientes') {
        ctx.message = { text: '/recientes' };
        await bot.command('recientes')(ctx);
    }
});

bot.command('status', async (ctx) => {
    const sessions = await loadSessions();
    const projects = sessions.projects || [];
    const bridgeInstances = hermesBridge.listInstances();

    // Ollama status (intentamos, no bloquea si falla)
    let ollamaStatus = '❓ Desconocido';
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            const data = await res.json();
            ollamaStatus = `🟢 Online (${data.models?.length || 0} modelos)`;
        } else {
            ollamaStatus = '🔴 Offline';
        }
    } catch {
        ollamaStatus = '🔴 Offline';
    }

    // Stats de agentes
    const byStatus = {};
    for (const inst of bridgeInstances) {
        byStatus[inst.status] = (byStatus[inst.status] || 0) + 1;
    }

    // Total tokens acumulados
    let totalTokens = 0;
    let totalCost = 0;
    for (const inst of bridgeInstances) {
        totalTokens += inst.cumulativeTokens || 0;
        totalCost += inst.cumulativeCost || 0;
    }

    const hostname = os.hostname();
    const uptime = process.uptime();
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    let msg = [
        `${EMOJI.status} *ESTADO DEL SISTEMA*`,
        '',
        `🖥️ *Servidor:* ${hostname} (uptime: ${uptimeStr})`,
        `${EMOJI.ollama} *Ollama:* ${ollamaStatus}`,
        '',
        `${EMOJI.project} *Proyectos:* ${projects.length}`,
        `${EMOJI.chat} *Chats totales:* ${projects.reduce((sum, p) => sum + (p.chats?.length || 0), 0)}`,
        '',
        `*Agentes Hermes:* ${bridgeInstances.length}`,
    ];

    if (byStatus.running) msg.push(`   🟢 Corriendo: ${byStatus.running}`);
    if (byStatus.idle) msg.push(`   🟡 Idle: ${byStatus.idle}`);
    if (byStatus.stopped) msg.push(`   🔴 Detenidos: ${byStatus.stopped}`);

    if (totalTokens > 0) {
        msg.push('');
        msg.push(`${EMOJI.token} *Tokens totales:* ${totalTokens.toLocaleString()}`);
        if (totalCost > 0) msg.push(`💰 *Costo estimado:* $${totalCost.toFixed(4)} USD`);
    }

    await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('proyectos', async (ctx) => {
    const sessions = await loadSessions();
    const projects = sessions.projects || [];

    if (projects.length === 0) {
        await ctx.reply(`${EMOJI.warn} No hay proyectos creados.`);
        return;
    }

    let msg = [`${EMOJI.project} *PROYECTOS (${projects.length})*`, ''];

    for (const proj of projects) {
        const bridgeAgents = hermesBridge.listProjectInstances(proj.id);
        const runningAgents = bridgeAgents.filter(a => a.status === 'running').length;
        const chatCount = proj.chats?.length || 0;
        
        msg.push(`${EMOJI.folder} *${proj.name || proj.id.slice(0, 8)}*`);
        msg.push(`   ID: \`${proj.id}\``);
        msg.push(`   Chats: ${chatCount} | Hermes: ${bridgeAgents.length} (${runningAgents} activos)`);
        if (proj.folder) msg.push(`   Carpeta: \`${proj.folder}\``);
        msg.push('');
    }

    await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('agentes', async (ctx) => {
    const sessions = await loadSessions();
    const projects = sessions.projects || [];
    const allInstances = hermesBridge.listInstances();

    const filterActive = ctx.message?.text?.includes('activo');

    if (allInstances.length === 0) {
        await ctx.reply(`${EMOJI.warn} No hay agentes Hermes activos. Usá /iniciar para crear uno.`);
        return;
    }

    // Agrupar por proyecto
    const byProject = {};
    for (const inst of allInstances) {
        if (filterActive && inst.status !== 'running') continue;
        const projId = inst.projectId;
        if (!byProject[projId]) byProject[projId] = { name: projId, agents: [] };
        byProject[projId].agents.push(inst);
    }

    if (Object.keys(byProject).length === 0) {
        await ctx.reply(`${EMOJI.idle} No hay agentes Hermes ${filterActive ? 'activos' : 'encontrados'}.`);
        return;
    }

    let msg = [`${EMOJI.agent} *AGENTES HERMES${filterActive ? ' ACTIVOS' : ''}*`, ''];

    for (const [projId, group] of Object.entries(byProject)) {
        const proj = projects.find(p => p.id === projId);
        const projName = proj?.name || projId.slice(0, 12);
        msg.push(`${EMOJI.folder} *${projName}*`);

        for (const agent of group.agents) {
            const statusIcon = statusEmoji(agent.status);
            const name = formatAgentName(agent);
            const modelShort = agent.model && agent.model !== 'default' 
                ? agent.model.split('/').pop() 
                : 'default';
            
            msg.push(`   ${statusIcon} *${name}* — ${agent.status} | ${EMOJI.model} ${modelShort}`);
            if (agent.cumulativeTokens > 0) {
                msg.push(`      ${EMOJI.token} ${agent.cumulativeTokens.toLocaleString()} tokens`);
            }
        }
        msg.push('');
    }

    msg.push(`Total: ${allInstances.length} agentes`);

    await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('recientes', async (ctx) => {
    const instances = hermesBridge.listInstances();
    
    // Ordenar por fecha de creación (más recientes primero)
    const sorted = [...instances].sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    ).slice(0, 5);

    if (sorted.length === 0) {
        await ctx.reply(`${EMOJI.warn} No hay agentes recientes.`);
        return;
    }

    let msg = [`${EMOJI.clock} *AGENTES RECIENTES*`, ''];

    for (const agent of sorted) {
        const created = new Date(agent.createdAt);
        const timeAgo = Math.floor((Date.now() - created) / 60000);
        const timeStr = timeAgo < 1 ? 'ahora' : timeAgo < 60 ? `${timeAgo}m` : `${Math.floor(timeAgo / 60)}h`;
        
        msg.push(`${statusEmoji(agent.status)} *${formatAgentName(agent)}*`);
        msg.push(`   Proyecto: ${agent.projectId.slice(0, 12)}`);
        msg.push(`   Creado: hace ${timeStr}`);
        if (agent.cumulativeTokens > 0) {
            msg.push(`   Tokens: ${agent.cumulativeTokens.toLocaleString()}`);
        }
    }

    await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('iniciar', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 2) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /iniciar <carpeta proyecto>\n\n` +
            `Ejemplo: /iniciar D:/Programacion/mi_proyecto\n\n` +
            `El agente tomará el nombre del proyecto automáticamente.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const folderPath = parts.slice(1).join(' ').replace(/"/g, '');
    const sessions = await loadSessions();
    const projects = sessions.projects || [];

    // Buscar el proyecto por carpeta exacta
    let project = projects.find(p => p.folder === folderPath);
    
    // Si no, buscar por coincidencia parcial (el usuario puede pasar solo el nombre)
    if (!project) {
        const folderBasename = path.basename(folderPath);
        project = projects.find(p => 
            p.folder && (p.folder.includes(folderPath) || p.folder.includes(folderBasename))
        );
    }

    if (!project) {
        await ctx.reply(
            `${EMOJI.warn} No se encontró un proyecto con esa carpeta.\n\n` +
            `Creá el proyecto en JP Agents primero, o usá /proyectos para ver los disponibles.\n\n` +
            `Carpeta buscada: \`${folderPath}\``,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Buscar chat Hermes en el proyecto
    const hermesChat = project.chats?.find(c => c.useHermes === true);

    if (!hermesChat) {
        await ctx.reply(
            `${EMOJI.warn} El proyecto no tiene un chat con Hermes habilitado.\n` +
            `Activá Hermes en algún chat del proyecto desde JP Agents.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    try {
        const instance = await hermesBridge.startInstance(
            project.id,
            hermesChat.id,
            project.folder,
            hermesChat.model || null,
            project.name || hermesChat.name
        );

        await ctx.reply(
            `${EMOJI.done} *Agente iniciado*\n\n` +
            `Nombre: *${formatAgentName(instance)}*\n` +
            `Proyecto: *${project.name || project.id.slice(0, 12)}*\n` +
            `Carpeta: \`${instance.workdir}\`\n` +
            `Modelo: ${instance.model}\n\n` +
            `Usá /chat \`${project.id.slice(0, 8)}\` <mensaje> para enviarle tareas.`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`${EMOJI.error} Error al iniciar agente: ${err.message}`);
    }
});

bot.command('detener', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 3) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /detener <projectId> <chatId>\n\n` +
            `Usá /agentes para ver los IDs.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const projectId = parts[1];
    const chatId = parts[2];

    try {
        await hermesBridge.stopInstance(projectId, chatId);
        await ctx.reply(`${EMOJI.done} Agente detenido: *${projectId}/${chatId}*`, { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`${EMOJI.error} Error al detener: ${err.message}`);
    }
});

// ─── /chat: Chatear con un agente por projectId (parcial) ───
bot.command('chat', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 3) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /chat <projectId> <mensaje>\n\n` +
            `Ejemplo: /chat mprs5jwv "Hacé un resumen del código"\n\n` +
            `Usá /agentes para ver los IDs de proyectos disponibles.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const projectIdFragment = parts[1];
    const message = parts.slice(2).join(' ');

    // Buscar instancia que coincida (parcial)
    const instances = hermesBridge.listInstances();
    const match = instances.find(i => 
        i.id.startsWith(projectIdFragment) || 
        i.projectId.startsWith(projectIdFragment) ||
        i.projectId === projectIdFragment
    );

    if (!match) {
        await ctx.reply(
            `${EMOJI.warn} No se encontró agente para \`${projectIdFragment}\`.\n\n` +
            `Usá /agentes para ver los disponibles.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    try {
        const statusMsg = await ctx.reply(
            `${EMOJI.thinking} *Enviando a ${match.name}...*`, 
            { parse_mode: 'Markdown' }
        );
        
        const result = await hermesBridge.sendMessage(match.projectId, match.chatId, message);
        const responseText = typeof result === 'string' ? result : (result?.text || '(sin respuesta)');
        
        const truncated = responseText.length > 3500 
            ? responseText.slice(0, 3500) + '\n\n...(respuesta truncada)'
            : responseText;
        
        // Notificación de completado (ya se envía desde server.js, pero reforzamos)
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            `${EMOJI.done} *${match.name}:*\n\n${truncated}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`${EMOJI.error} Error: ${err.message}`);
    }
});

// ─── /logs: Ver logs recientes de un agente ───
bot.command('logs', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 2) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /logs <projectId>\n\n` +
            `Muestra los últimos logs del agente. Usá /agentes para ver IDs.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const projectIdFragment = parts[1];
    const instances = hermesBridge.listInstances();
    const match = instances.find(i => 
        i.id.startsWith(projectIdFragment) || 
        i.projectId.startsWith(projectIdFragment) ||
        i.projectId === projectIdFragment
    );

    if (!match) {
        await ctx.reply(`${EMOJI.warn} No se encontró agente para \`${projectIdFragment}\`.`);
        return;
    }

    const logs = hermesBridge.getLogs(match.projectId, match.chatId, 10);
    
    if (logs.length === 0) {
        await ctx.reply(`${EMOJI.warn} No hay logs para *${match.name}*.`, { parse_mode: 'Markdown' });
        return;
    }

    let report = [`${EMOJI.skill} *Logs de ${match.name}*`, ''];
    for (const log of logs) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const type = log.type === 'query' ? '📤' : '📥';
        const preview = (log.text || '').slice(0, 100);
        report.push(`${type} [${time}] ${preview}`);
    }

    await ctx.reply(report.join('\n'), { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 2) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /broadcast <mensaje>\n\n` +
            `Envía el mensaje a TODOS los agentes Hermes activos.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const message = parts.slice(1).join(' ');
    const instances = hermesBridge.listInstances();
    const activeInstances = instances.filter(i => i.status !== 'stopped');

    if (activeInstances.length === 0) {
        await ctx.reply(`${EMOJI.warn} No hay agentes activos para hacer broadcast.`);
        return;
    }

    await ctx.reply(`${EMOJI.message} Enviando broadcast a *${activeInstances.length}* agentes...`, { parse_mode: 'Markdown' });

    const results = await hermesBridge.broadcast(message);
    
    let report = [`${EMOJI.done} *Broadcast completado*`, ''];
    for (const r of results) {
        const icon = r.status === 'ok' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌';
        const agentName = formatAgentName(instances.find(i => i.id === r.id) || { id: r.id });
        report.push(`${icon} ${agentName}: ${r.status === 'ok' ? 'Respondió' : r.reason || r.error || 'error'}`);
    }

    await ctx.reply(report.join('\\n'), { parse_mode: 'Markdown' });
});

// ─── /nuevo_proyecto: Crear un proyecto desde Telegram ───
bot.command('nuevo_proyecto', async (ctx) => {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    
    if (parts.length < 3) {
        await ctx.reply(
            `${EMOJI.warn} *Uso:* /nuevo_proyecto <nombre> <carpeta>\n\n` +
            `Ejemplo: /nuevo_proyecto MiApp D:/Programacion/mi_app\n\n` +
            `Crea un proyecto nuevo y lo registra en JP Agents.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const name = parts[1];
    const folderPath = parts.slice(2).join(' ').replace(/"/g, '');
    
    try {
        const fetch = (await import('node-fetch')).default;
        const sessions = await loadSessions();
        
        const existing = (sessions.projects || []).find(p => p.folder === folderPath);
        if (existing) {
            await ctx.reply(
                `${EMOJI.warn} Ya existe un proyecto en esa carpeta:\n` +
                `*${existing.name || existing.id.slice(0, 8)}* (ID: \`${existing.id.slice(0, 12)}\`)`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const resp = await fetch('http://localhost:3001/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, folder: folderPath })
        });
        
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${resp.status}`);
        }
        
        const project = await resp.json();
        
        await ctx.reply(
            `${EMOJI.done} *Proyecto creado*\n\n` +
            `Nombre: *${name}*\n` +
            `ID: \`${project.id || 'desconocido'}\`\n` +
            `Carpeta: \`${folderPath}\`\n\n` +
            `Usa /iniciar \`${folderPath}\` para arrancar un agente.`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        await ctx.reply(`${EMOJI.error} Error al crear proyecto: ${err.message}`);
    }
});

// ─── /skills: Listar skills disponibles ───
bot.command('skills', async (ctx) => {
    try {
        const fetch = (await import('node-fetch')).default;
        
        const [localResp, hermesResp] = await Promise.allSettled([
            fetch('http://localhost:3001/api/skills/list', { signal: AbortSignal.timeout(5000) }),
            fetch('http://localhost:3001/api/hermes/skills', { signal: AbortSignal.timeout(5000) })
        ]);
        
        let localSkills = [];
        let hermesSkills = [];
        
        if (localResp.status === 'fulfilled' && localResp.value.ok) {
            const data = await localResp.value.json();
            localSkills = data.skills || data || [];
        }
        if (hermesResp.status === 'fulfilled' && hermesResp.value.ok) {
            const data = await hermesResp.value.json();
            hermesSkills = data.skills || data || [];
        }
        
        if (localSkills.length === 0 && hermesSkills.length === 0) {
            await ctx.reply(`${EMOJI.warn} No se encontraron skills disponibles.`);
            return;
        }
        
        let msg = [`${EMOJI.skill} *SKILLS DISPONIBLES*`, ''];
        
        if (localSkills.length > 0) {
            msg.push('📁 *Skills Locales:*');
            for (const s of (Array.isArray(localSkills) ? localSkills : []).slice(0, 10)) {
                const name = typeof s === 'string' ? s : (s.name || s.id);
                const desc = typeof s === 'object' ? (s.description || '') : '';
                msg.push(`   • *${name}*${desc ? ' - ' + desc.slice(0, 60) : ''}`);
            }
            if (localSkills.length > 10) msg.push(`   ...y ${localSkills.length - 10} mas`);
            msg.push('');
        }
        
        if (hermesSkills.length > 0) {
            msg.push('⚡ *Skills Hermes:*');
            for (const s of (Array.isArray(hermesSkills) ? hermesSkills : []).slice(0, 10)) {
                const name = typeof s === 'string' ? s : (s.name || s.id);
                const desc = typeof s === 'object' ? (s.description || '') : '';
                msg.push(`   • *${name}*${desc ? ' - ' + desc.slice(0, 60) : ''}`);
            }
            if (hermesSkills.length > 10) msg.push(`   ...y ${hermesSkills.length - 10} mas`);
        }
        
        const total = (Array.isArray(localSkills) ? localSkills.length : 0) + (Array.isArray(hermesSkills) ? hermesSkills.length : 0);
        msg.push(`\nTotal: ${total} skills`);
        
        await ctx.reply(msg.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
        await ctx.reply(`${EMOJI.error} Error al listar skills: ${err.message}`);
    }
});

// ─── Manejar mensajes de texto (no comandos) → HERMES ADMIN ───
// TODOS los mensajes de texto sin comando van a Hermes con skill BOTADMIN
bot.on('message:text', async (ctx) => {
    // Ignorar comandos (ya procesados)
    if (ctx.message.text.startsWith('/')) return;
    
    const userMessage = ctx.message.text;
    
    // Enviar a Hermes ADMIN con BOTADMIN skill
    const statusMsg = await ctx.reply(`${EMOJI.thinking} *HERMES ADMIN procesando...*`, { parse_mode: 'Markdown' });
    
    try {
        const result = await askHermesAdmin(userMessage);
        
        if (result.error) {
            await ctx.api.editMessageText(
                statusMsg.chat.id,
                statusMsg.message_id,
                `${EMOJI.error} *Error:* ${result.error}`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        const responseText = result.text || '(sin respuesta)';
        
        // Telegram limit: 4096 chars
        if (responseText.length > 4000) {
            await ctx.api.editMessageText(
                statusMsg.chat.id,
                statusMsg.message_id,
                responseText.slice(0, 4000) + '\n\n...(continuación)',
                { parse_mode: 'Markdown' }
            );
            if (responseText.length > 4000) {
                await ctx.reply(responseText.slice(4000, 8000));
            }
        } else {
            await ctx.api.editMessageText(
                statusMsg.chat.id,
                statusMsg.message_id,
                responseText,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (err) {
        await ctx.api.editMessageText(
            statusMsg.chat.id,
            statusMsg.message_id,
            `${EMOJI.error} Error: ${err.message}`,
            { parse_mode: 'Markdown' }
        );
    }
});

/**
 * Consulta a Hermes con skill BOTADMIN (modo ADMIN)
 */
async function askHermesAdmin(message) {
    try {
        // Usar hermesBridge para correr Hermes oneshot con skill BOTADMIN
        const hermesPath = await hermesBridge._findHermesPath(process.cwd());
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        
        const args = [
            'chat', '-q', message,
            '-s', 'botadmin',
            '--verbose',
            '--source', `telegram-admin-bot|jpagentes|admin`
        ];
        
        console.log(`[TELEGRAM-HERMES] ▶️ Consultando Hermes ADMIN: "${message.slice(0, 80)}..."`);
        
        const { stdout, stderr } = await execFileAsync(hermesPath, args, {
            cwd: process.cwd(),
            timeout: 120000,
            env: { ...process.env }
        });
        
        // Extraer respuesta del panel
        const clean = stdout.replace(/\x1b\[[\d;]*[A-Za-z@-_]/g, '').replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '');
        const lines = clean.split('\n');
        let panelStart = -1, panelEnd = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].includes('╰') && panelEnd === -1) panelEnd = i;
            if (lines[i].includes('╭') && lines[i].includes('Hermes') && panelStart === -1) {
                panelStart = i;
                if (panelEnd === -1) panelEnd = lines.length;
                break;
            }
        }
        
        let response = clean.trim().slice(0, 8000);
        if (panelStart !== -1 && panelEnd !== -1 && panelStart < panelEnd) {
            response = lines.slice(panelStart + 1, panelEnd)
                .map(l => l.replace(/^[││]\s*/, '').replace(/\s*[││]$/, ''))
                .join('\n').trim().slice(0, 8000);
        }
        
        if (!response) response = '(Hermes no devolvió respuesta visible)';
        
        return { text: response, exitCode: 0 };
    } catch (err) {
        return { error: err.message, text: '' };
    }
}

// ─── Métodos públicos para notificaciones ───

/**
 * Envía una notificación al dueño del bot
 * @param {string} message
 */
async function notifyOwner(message) {
    if (!ownerChatId) {
        console.warn('[TELEGRAM] No hay ownerChatId para enviar notificación');
        return;
    }
    try {
        await bot.api.sendMessage(ownerChatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('[TELEGRAM] Error enviando notificación al owner:', err.message);
    }
}

/**
 * Notifica que un agente terminó su tarea
 */
function notifyAgentComplete(instance, response, error = null) {
    const name = formatAgentName(instance);
    if (error) {
        notifyOwner(
            `${EMOJI.error} *Agente finalizó con error*\n` +
            `Agente: *${name}*\n` +
            `Proyecto: ${instance.projectId}\n` +
            `Error: ${error.message || error}`
        );
    } else {
        const preview = (response?.text || response || '').toString().slice(0, 200);
        notifyOwner(
            `${EMOJI.done} *Agente completó tarea*\n` +
            `Agente: *${name}*\n` +
            `Proyecto: ${instance.projectId}\n` +
            `Respuesta: ${preview}${preview.length >= 200 ? '...' : ''}`
        );
    }
}

// ─── Inicialización ───

/**
 * Inicializa el bot de Telegram.
 * @param {object} dependencies
 * @param {HermesBridge} dependencies.hermesBridge - Instancia del bridge
 * @param {Function} dependencies.loadSessions - Función para cargar sesiones
 */
export function initTelegramBot({ hermesBridge: bridge, loadSessions: loadSessFn }) {
    hermesBridge = bridge;
    loadSessionsFn = loadSessFn;

    // Hook: escuchar cambios de estado del bridge para notificar
    hermesBridge.on('status', ({ instanceKey, status }) => {
        if (status === 'idle') {
            // Un agente terminó — buscar la instancia y notificar
            const instance = hermesBridge.instances.get(instanceKey);
            if (instance) {
                const name = formatAgentName(instance);
                // La notificación de tarea completada se maneja desde sendMessage
                // porque ahí tenemos acceso a la respuesta. Acá solo marcamos.
                console.log(`[TELEGRAM] Agente ${name} volvió a idle`);
            }
        }
    });

    // ─── Iniciar polling con retry ante 409 ───
    startBotWithRetry(3, 2000);

    return {
        notifyOwner,
        notifyAgentComplete,
        stop: stopBot,
        getOwnerChatId: () => ownerChatId,
        isRunning: () => bot.isInited(),
    };
}

/**
 * Intenta iniciar el bot con retry exponencial ante 409 Conflict.
 * El 409 ocurre cuando otro proceso (ej: el old process durante restart)
 * todavía tiene una sesión getUpdates activa.
 */
async function startBotWithRetry(maxRetries = 3, baseDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await bot.start({
                onStart: (botInfo) => {
                    console.log(`[TELEGRAM] ✅ Bot iniciado como @${botInfo.username}`);
                    console.log(`[TELEGRAM] Token: ${BOT_TOKEN.slice(0, 10)}...`);
                    if (AUTHORIZED_USERS.length > 0) {
                        console.log(`[TELEGRAM] Usuarios autorizados: ${AUTHORIZED_USERS.join(', ')}`);
                    } else {
                        console.log('[TELEGRAM] Modo: primera persona que hable será el dueño');
                    }
                },
                drop_pending_updates: true
            });
            return; // Éxito
        } catch (err) {
            const is409 = err.message.includes('409') || err.message.includes('Conflict');
            const is401 = err.message.includes('401');
            
            if (is401) {
                console.error('[TELEGRAM] ❌ Token inválido. Verificá el token en BotFather.');
                return; // No retry for 401
            }
            
            if (is409 && attempt < maxRetries) {
                const delay = baseDelay * attempt; // 2s, 4s, 6s
                console.log(`[TELEGRAM] ⚠️ 409 Conflict (intento ${attempt}/${maxRetries}). Reintentando en ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            
            console.error(`[TELEGRAM] ❌ Error al iniciar el bot (intento ${attempt}/${maxRetries}):`, err.message);
        }
    }
}

/**
 * Detiene el polling del bot de forma limpia.
 * Devuelve una Promise que resuelve cuando el bot se detuvo.
 * Útil para llamar antes de un restart.
 */
async function stopBot() {
    if (!bot.isInited()) {
        console.log('[TELEGRAM] Bot ya estaba detenido.');
        return;
    }
    console.log('[TELEGRAM] Deteniendo bot...');
    try {
        await bot.stop({ drop_pending_updates: true });
        console.log('[TELEGRAM] ✅ Bot detenido correctamente.');
    } catch (err) {
        console.error('[TELEGRAM] ⚠️ Error al detener bot:', err.message);
    }
}

export { notifyOwner, notifyAgentComplete, bot, EMOJI };
