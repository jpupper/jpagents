/**
 * Matrix Agentic Tree Visualization
 * Uses D3.js to render a futuristic, interactive tree of agent actions.
 */

export function initMatrix(containerId, svgId) {
    const svg = d3.select(`#${svgId}`);
    const container = document.getElementById(containerId);
    const tooltip = document.getElementById('matrix-tooltip');
    
    let width = container.clientWidth;
    let height = container.clientHeight;
    let currentFilter = null;
    
    const g = svg.append("g");

    // Zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.1, 3])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });

    svg.call(zoom);

    window.addEventListener('resize', () => {
        width = container.clientWidth;
        height = container.clientHeight;
    });

    async function update(filterProjectId = null) {
        if (filterProjectId !== undefined && filterProjectId !== 'admin') {
            currentFilter = filterProjectId;
        } else if (filterProjectId === 'admin') {
            currentFilter = null;
        }
        
        try {
            const response = await fetch(`${window.API_BASE}/admin/traces`);
            const traces = await response.json();
            
            const data = transformTracesToTree(traces, currentFilter);
            renderTree(data);
        } catch (e) {
            console.error("Matrix update error:", e);
        }
    }

    function transformTracesToTree(traces, filterProjectId = null) {
        const root = { name: filterProjectId ? `Proyecto: ${filterProjectId}` : "Orquestador", children: [], type: 'root' };
        const projectsMap = {};

        traces.forEach(trace => {
            // Si hay un filtro y no coincide, saltar
            if (filterProjectId && trace.projectId !== filterProjectId) return;

            if (!projectsMap[trace.projectId]) {
                projectsMap[trace.projectId] = { name: `Proyecto: ${trace.projectId}`, children: [], type: 'project', id: trace.projectId };
                if (!filterProjectId) {
                    root.children.push(projectsMap[trace.projectId]);
                }
            }

            const targetNode = filterProjectId ? root : projectsMap[trace.projectId];
            let thread = targetNode.children.find(c => c.id === trace.agentId);
            
            if (!thread) {
                thread = { name: `Agente: ${trace.agentId.substring(0,8)}`, children: [], type: 'agent', id: trace.agentId };
                targetNode.children.push(thread);
            }

            thread.children.push({
                name: trace.stepName,
                type: 'step',
                details: trace.details,
                timestamp: trace.timestamp
            });
        });

        return root;
    }

    function renderTree(data) {
        const hierarchy = d3.hierarchy(data);
        const treeLayout = d3.tree().size([height, width - 200]);
        treeLayout(hierarchy);

        // Links
        g.selectAll(".link")
            .data(hierarchy.links())
            .join("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal()
                .x(d => d.y)
                .y(d => d.x));

        // Nodes
        const nodes = g.selectAll(".node")
            .data(hierarchy.descendants())
            .join("g")
            .attr("class", d => `node ${d.data.type}`)
            .attr("transform", d => `translate(${d.y},${d.x})`);

        nodes.selectAll("circle")
            .data(d => [d])
            .join("circle")
            .attr("r", d => d.data.type === 'root' ? 8 : (d.data.type === 'project' ? 6 : 4))
            .attr("fill", d => getNodeColor(d.data))
            .style("filter", d => `drop-shadow(0 0 5px ${getNodeColor(d.data)})`)
            .on("mouseover", (event, d) => {
                tooltip.classList.remove('hidden');
                tooltip.style.left = (event.pageX + 10) + 'px';
                tooltip.style.top = (event.pageY + 10) + 'px';
                
                let detailsHtml = '';
                if (d.data.details) {
                    if (d.data.name.includes('tool')) {
                        const tool = d.data.details.tool || 'Desconocida';
                        const args = d.data.details.args ? ` -> <code>${d.data.details.args.path || ''}</code>` : '';
                        detailsHtml = `<p><strong>🛠️ Herramienta:</strong> ${tool}${args}</p>`;
                    } else {
                        detailsHtml = `<pre>${JSON.stringify(d.data.details, null, 2)}</pre>`;
                    }
                }

                tooltip.innerHTML = `
                    <h4>${d.data.name}</h4>
                    <p>Tipo: ${d.data.type}</p>
                    ${detailsHtml}
                    ${d.data.timestamp ? `<p><small>${new Date(d.data.timestamp).toLocaleTimeString()}</small></p>` : ''}
                `;
            })
            .on("mouseout", () => {
                tooltip.classList.add('hidden');
            });

        nodes.selectAll("text")
            .data(d => [d])
            .join("text")
            .attr("dy", ".35em")
            .attr("x", d => d.children ? -12 : 12)
            .attr("text-anchor", d => d.children ? "end" : "start")
            .text(d => d.data.name);
    }

    function getNodeColor(data) {
        if (data.type === 'root') return "#7c4dff";
        if (data.type === 'project') return "#00f2ff";
        if (data.type === 'agent') return "#3b82f6";
        
        const step = data.name;
        if (step.includes('thinking')) return "#3b82f6";
        if (step.includes('tool_call')) return "#10b981";
        if (step.includes('tool_result')) return data.details?.success ? "#10b981" : "#ef4444";
        if (step.includes('reflection')) return "#f59e0b";
        return "#ffffff";
    }

    // Auto-update every 5 seconds using the currentFilter
    const interval = setInterval(() => update(currentFilter), 5000);
    update();

    return {
        update,
        resetZoom: () => {
            svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        },
        destroy: () => clearInterval(interval)
    };
}
