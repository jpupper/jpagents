/**
 * memory-graph.js — Memory Graph Visualization (D3-force)
 *
 * Renderiza un force-directed graph de las dependencias del proyecto.
 * Se integra como 'grafo' tab en la UI existente.
 *
 * Funcionalidades:
 * - Force-directed layout con D3 (ya cargado en lib/d3.min.js)
 * - Nodos: archivos (code=azul, style=verde, html=naranja, data=amarillo)
 * - Edges: flechas que muestran imports
 * - Zoom/Pan/Pinch
 * - Hover: info del nodo
 * - Click nodo → resalta subgrafo (1-hop vecinos)
 * - Botón refresh: re-escanear proyecto
 * - Contador: N nodos, M edges
 */

let _graphInstance = null;

/**
 * Inicializa la visualización del grafo.
 * @param {string} containerId - ID del contenedor del SVG
 * @param {string} svgId - ID del elemento SVG
 */
export function initMemoryGraph(containerId, svgId) {
  if (_graphInstance) {
    _graphInstance.destroy();
  }

  const container = document.getElementById(containerId);
  const svg = d3.select(`#${svgId}`);
  if (!container || svg.empty()) {
    console.warn('[MEMORY-GRAPH] Container or SVG not found');
    return null;
  }

  // ─── Dimensiones ───
  let width = container.clientWidth || 800;
  let height = container.clientHeight || 600;

  // ─── Elementos ───
  // Buscar tooltip con el ID correcto según el contexto (matrix o modal)
  const tooltip = document.getElementById('matrix-graph-tooltip') || document.getElementById('graph-tooltip');

  const defs = svg.append('defs');

  // Flecha para edges
  defs.append('marker')
    .attr('id', 'graph-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 8)
    .attr('markerHeight', 8)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', 'var(--border-color, #555)');

  // Grupo principal (para zoom)
  const g = svg.append('g').attr('class', 'graph-main-group');

  // ─── Zoom ───
  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  // ─── Resize handler ───
  const onResize = () => {
    width = container.clientWidth || 800;
    height = container.clientHeight || 600;
    svg.attr('width', width).attr('height', height);
  };
  window.addEventListener('resize', onResize);

  // ─── Data inicial ───
  let currentData = null;
  let currentProjectId = null;
  let simulation = null;

  // ─── Colores por tipo ───
  function getNodeColor(node) {
    switch (node.type) {
      case 'code': return '#3b82f6';   // azul
      case 'style': return '#10b981';  // verde
      case 'html': return '#f59e0b';   // naranja
      case 'data': return '#8b5cf6';   // púrpura
      default: return '#6b7280';       // gris
    }
  }

  function getNodeGlow(node) {
    const color = getNodeColor(node);
    return `drop-shadow(0 0 6px ${color})`;
  }

  // ─── Tooltip ───
  function showTooltip(event, d) {
    if (!tooltip) return;
    tooltip.classList.remove('hidden');
    tooltip.style.position = 'fixed';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';

    // Ajustar para no salir de pantalla
    const rect = tooltip.getBoundingClientRect();
    if (event.clientX + 15 + rect.width > window.innerWidth) {
      tooltip.style.left = (event.clientX - rect.width - 15) + 'px';
    }
    if (event.clientY + 15 + rect.height > window.innerHeight) {
      tooltip.style.top = (event.clientY - rect.height - 15) + 'px';
    }

    // Conexiones (source/target pueden ser objetos tras D3 force)
    const deps = currentData?.edges?.filter(e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      return sid === d.id;
    }).length || 0;
    const depBy = currentData?.edges?.filter(e => {
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      return tid === d.id;
    }).length || 0;
    const sizeStr = d.size ? (d.size / 1024).toFixed(1) + 'KB' : '?';

    tooltip.innerHTML = `
      <div class="graph-tooltip-header" style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="color:${getNodeColor(d)}">${d.name}</strong>
      </div>
      <div class="graph-tooltip-body">
        <div>📁 ${d.file}</div>
        <div>📐 ${d.type} · ${sizeStr}</div>
        <div>⬅️ ${depBy} dependen · ➡️ ${deps} depende de</div>
      </div>
    `;
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.add('hidden');
  }

  // ─── Render ───
  function render(data) {
    currentData = data;
    if (!data || !data.nodes || data.nodes.length === 0) {
      g.selectAll('*').remove();
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-secondary, #888)')
        .attr('font-size', '16px')
        .text('No hay datos. Hacé clic en 🔄 Escanear');
      updateStats(0, 0);
      return;
    }

    // Limitar a 200 nodos para performance
    let nodes = data.nodes;
    let edges = data.edges || [];
    if (nodes.length > 200) {
      // Tomar los archivos más relevantes (por tamaño y conexiones)
      const edgeCount = new Map();
      for (const e of edges) {
        edgeCount.set(e.source, (edgeCount.get(e.source) || 0) + 1);
        edgeCount.set(e.target, (edgeCount.get(e.target) || 0) + 1);
      }
      nodes = nodes
        .map(n => ({ ...n, connections: edgeCount.get(n.id) || 0 }))
        .sort((a, b) => b.connections - a.connections || (b.size || 0) - (a.size || 0))
        .slice(0, 200);
      const validIds = new Set(nodes.map(n => n.id));
      edges = edges.filter(e => validIds.has(e.source) && validIds.has(e.target));
    }

    // Limpiar (incluye posible texto de loading)
    g.selectAll('*').remove();

    // ─── Simulation ───
    if (simulation) simulation.stop();

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(d => d.id)
        .distance(100)
        .strength(0.3))
      .force('charge', d3.forceManyBody()
        .strength(-200)
        .distanceMax(400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(8));

    // ─── Links ───
    const link = g.append('g')
      .attr('class', 'graph-links')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'var(--border-color, #444)')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.4)
      .attr('marker-end', 'url(#graph-arrow)');

    // ─── Nodes ───
    const node = g.append('g')
      .attr('class', 'graph-nodes')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => Math.max(4, Math.min(12, Math.sqrt((d.size || 1000) / 500))))
      .attr('fill', d => getNodeColor(d))
      .attr('stroke', '#1a1a2e')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .style('filter', d => getNodeGlow(d))
      .on('mouseover', (event, d) => {
        showTooltip(event, d);
        // Highlight connections
        const connected = new Set();
        connected.add(d.id);
        for (const e of edges) {
          if (e.source.id === d.id || e.source === d.id) connected.add(e.target.id || e.target);
          if (e.target.id === d.id || e.target === d.id) connected.add(e.source.id || e.source);
        }
        node.attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
        link.attr('stroke-opacity', e => {
          const sid = e.source.id || e.source;
          const tid = e.target.id || e.target;
          return (sid === d.id || tid === d.id) ? 0.8 : 0.05;
        });
      })
      .on('mouseout', () => {
        hideTooltip();
        node.attr('opacity', 1);
        link.attr('stroke-opacity', 0.4);
      })
      .on('click', (event, d) => {
        // Click → abrir archivo si es posible
        if (window.openFileFromGraph) {
          window.openFileFromGraph(d.file);
        }
      })
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          // NO soltar el nodo — queda fijo donde lo dejó el usuario
          // Para des-pinchar: doble click en el nodo
        })
      );

    // ─── Double-click: unpin node ───
    node.on('dblclick', (event, d) => {
      d.fx = null;
      d.fy = null;
      if (simulation) simulation.alpha(0.3).restart();
    });

    // ─── Labels (solo archivos grandes/conexiones) ───
    const labelNodes = nodes
      .filter(n => (n.size || 0) > 5000 || (edges.filter(e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        return sid === n.id || tid === n.id;
      }).length) > 3)
      .slice(0, 50);

    const label = g.append('g')
      .attr('class', 'graph-labels')
      .selectAll('text')
      .data(labelNodes)
      .join('text')
      .text(d => d.name.length > 25 ? d.name.slice(0, 22) + '...' : d.name)
      .attr('font-size', '9px')
      .attr('fill', 'var(--text-secondary, #aaa)')
      .attr('dx', 14)
      .attr('dy', 4)
      .style('pointer-events', 'none');

    // ─── Tick ───
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);

      label
        .attr('x', d => d.x)
        .attr('y', d => d.y);
    });

    // ─── Stats ───
    updateStats(data.nodes.length, data.edges.length);
  }

  function updateStats(nodes, edges) {
    const el = document.getElementById('graph-stats');
    if (el) el.textContent = `${nodes} archivos · ${edges} dependencias`;
  }

  // ─── Cargar datos del servidor ───
  async function loadGraph(projectId) {
    if (!projectId) return;
    currentProjectId = projectId;

    try {
      // Mostrar loading
      g.selectAll('*').remove();
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-secondary, #888)')
        .attr('font-size', '14px')
        .text('🔄 Cargando grafo de dependencias...');

      const res = await fetch(
        `${window.API_BASE || 'http://localhost:4699/api'}/memory/graph?projectId=${encodeURIComponent(projectId)}`
      );

      if (!res.ok) {
        if (res.status === 404) {
          g.selectAll('*').remove();
          g.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2 - 20)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-secondary, #888)')
            .attr('font-size', '14px')
            .text('📊 Grafo no disponible. Hacé clic en 🔄 Escanear para generar.');
          updateStats(0, 0);
        }
        return;
      }

      const data = await res.json();
      render(data);
    } catch (e) {
      console.error('[MEMORY-GRAPH] Error loading graph:', e);
      g.selectAll('*').remove();
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ef4444')
        .attr('font-size', '14px')
        .text('❌ Error al cargar: ' + e.message);
    }
  }

  // ─── Escanear proyecto ───
  async function scanProject(projectId, folderPath) {
    if (!projectId || !folderPath) {
      console.warn('[MEMORY-GRAPH] No projectId or folderPath');
      return;
    }

    // Show scanning message
    g.selectAll('*').remove();
    g.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-secondary, #888)')
      .attr('font-size', '14px')
      .text('🔍 Escaneando proyecto...');

    try {
      const res = await fetch(
        `${window.API_BASE || 'http://localhost:4699/api'}/memory/scan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, folderPath })
        }
      );
      if (res.ok) {
        const data = await res.json();
        render(data);
      } else {
        const err = await res.text();
        throw new Error(err);
      }
    } catch (e) {
      console.error('[MEMORY-GRAPH] Scan error:', e);
      g.selectAll('*').remove();
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ef4444')
        .attr('font-size', '14px')
        .text('❌ Error al escanear: ' + e.message);
    }
  }

  // ─── Reset zoom ───
  function resetZoom() {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  }

  // ─── API expuesta ───
  const instance = {
    loadGraph,
    scanProject,
    resetZoom,
    render,
    destroy: () => {
      if (simulation) simulation.stop();
      window.removeEventListener('resize', onResize);
      _graphInstance = null;
    }
  };

  _graphInstance = instance;
  return instance;
}

/**
 * Obtiene la instancia actual del grafo (para botones externos).
 */
export function getGraphInstance() {
  return _graphInstance;
}
