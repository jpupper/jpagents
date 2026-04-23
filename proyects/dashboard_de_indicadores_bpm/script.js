document.addEventListener('DOMContentLoaded', () => {
    const kpiSelectors = {
        heartRate: document.getElementById('heart-rate-value'),
        steps: document.getElementById('steps-value'),
        calories: document.getElementById('calories-value')
    };

    /**
     * Simula la llamada a una API para obtener datos de KPIs.
     * @returns {Promise<{heartRate: number, steps: number, calories: number}>}
     */
    const fetchSimulatedData = () => {
        return new Promise((resolve) => {
            // Simula latencia de red (fetch)
            setTimeout(() => {
                const data = {
                    // Rango de frecuencia cardíaca (60-100 bpm)
                    heartRate: Math.floor(Math.random() * 41) + 60, 
                    // Rango de pasos (5000-15000)
                    steps: Math.floor(Math.random() * 10001) + 5000,
                    // Rango de calorías (300-1200 kcal)
                    calories: Math.floor(Math.random() * 901) + 300
                };
                resolve(data);
            }, 500); // 500ms de simulación de carga
        });
    };

    /**
     * Actualiza los elementos del DOM con los datos proporcionados.
     * @param {{heartRate: number, steps: number, calories: number}} data - Los datos del KPI.
     */
    const renderDashboard = (data) => {
        if (kpiSelectors.heartRate) {
            kpiSelectors.heartRate.textContent = `${data.heartRate} BPM`;
            // Se podría añadir una lógica de color aquí basada en el valor
        }
        if (kpiSelectors.steps) {
            kpiSelectors.steps.textContent = `${data.steps.toLocaleString()} pasos`;
        }
        if (kpiSelectors.calories) {
            kpiSelectors.calories.textContent = `${data.calories.toLocaleString()} Kcal`;
        }
    };

    /**
     * Función principal para cargar y renderizar los datos.
     */
    const initializeDashboard = async () => {
        console.log('Iniciando carga de datos del dashboard...');
        try {
            const kpiData = await fetchSimulatedData();
            renderDashboard(kpiData);
            console.log('✅ Dashboard inicializado con éxito.');

            // === SIMULACIÓN DE INTERACTIVIDAD PERIÓDICA ===
            // Configura la actualización de datos cada 5 segundos
            setInterval(async () => {
                console.log('Actualizando KPIs...');
                try {
                    const newData = await fetchSimulatedData();
                    renderDashboard(newData);
                } catch (error) {
                    console.error('Error al refrescar datos:', error);
                }
            }, 5000);

        } catch (error) {
            console.error('❌ Fallo crítico al cargar el dashboard:', error);
            document.getElementById('kpi-container').innerHTML = '<p class="error">No se pudieron cargar los datos del dashboard. Intente recargar.</p>';
        }
    };

    // Ejecutar la inicialización al cargar el DOM
    initializeDashboard();
});
</script>