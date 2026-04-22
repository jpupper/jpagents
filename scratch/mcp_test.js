
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function testConnection() {
    console.log("🚀 Iniciando prueba de conexión MCP...");
    const transport = new SSEClientTransport(new URL("http://localhost:2998/sse"));
    const client = new Client({
        name: "test-client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    try {
        console.log("📡 Conectando al transporte SSE...");
        await client.connect(transport);
        console.log("✅ Conexión establecida con éxito.");

        console.log("🔍 Solicitando lista de herramientas...");
        const tools = await client.listTools();
        console.log("🛠️ Herramientas encontradas:", tools.tools.map(t => t.name).join(", "));
        
        if (tools.tools.length > 0) {
            console.log("\n✨ PRUEBA EXITOSA: El servidor MCP está respondiendo correctamente.");
        } else {
            console.log("\n⚠️ ADVERTENCIA: El servidor conectó pero no devolvió herramientas.");
        }

        await client.close();
        process.exit(0);
    } catch (error) {
        console.error("\n❌ ERROR DE PRUEBA:", error.message);
        process.exit(1);
    }
}

testConnection();
