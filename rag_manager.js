import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OllamaEmbeddings } from '@langchain/ollama';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { Document } from '@langchain/core/documents';
import { getCollection } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VECTOR_STORE_DIR = path.join(__dirname, 'vector_store');
const UPLOADS_DIR = path.join(__dirname, 'rag_uploads');

let vectorStore = null;

// Initialize the embedding model
const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text", // Lightweight model for embeddings
    baseUrl: "http://localhost:11434"
});

async function ensureDirs() {
    await fs.mkdir(VECTOR_STORE_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function initVectorStore() {
    await ensureDirs();
    try {
        // Try to load existing store
        const args = { space: "cosine" };
        vectorStore = await HNSWLib.load(VECTOR_STORE_DIR, embeddings);
        console.log('✅ Base de datos vectorial (RAG) cargada correctamente.');
    } catch (e) {
        // Create new empty store if it doesn't exist
        console.log('⚠️ Base de datos vectorial no encontrada. Creando una nueva...');
        // Create a dummy document to initialize the store, then we'll clear it or just leave it
        const docs = [new Document({ pageContent: "init", metadata: { init: true } })];
        vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
        await vectorStore.save(VECTOR_STORE_DIR);
    }
}

export async function processDocument(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    let text = "";

    try {
        if (ext === '.pdf') {
            const dataBuffer = await fs.readFile(filePath);
            const data = await pdfParse(dataBuffer);
            text = data.text;
        } else if (ext === '.txt' || ext === '.md' || ext === '.json') {
            text = await fs.readFile(filePath, 'utf-8');
        } else {
            throw new Error('Formato no soportado');
        }

        // Split text
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const docs = await splitter.createDocuments([text], [{ source: originalName }]);

        // Add to vector store
        if (!vectorStore) await initVectorStore();
        await vectorStore.addDocuments(docs);
        await vectorStore.save(VECTOR_STORE_DIR);

        // Save metadata to DB
        const collection = getCollection('rag_documents');
        const stats = await fs.stat(filePath);
        await collection.insertOne({
            name: originalName,
            size: stats.size,
            chunks: docs.length,
            uploadDate: new Date()
        });

        return { success: true, chunks: docs.length };
    } catch (e) {
        console.error('Error processing document:', e);
        throw e;
    }
}

export async function getDocuments() {
    const collection = getCollection('rag_documents');
    return await collection.find({}).sort({ uploadDate: -1 }).toArray();
}

export async function deleteDocument(name) {
    const collection = getCollection('rag_documents');
    await collection.deleteOne({ name });
    
    // Deleting from HNSWLib is tricky as it doesn't support direct deletion by metadata easily.
    // For a real production app, we would use ChromaDB or LanceDB.
    // As a workaround, we will just delete the file from the DB to not show it.
    // Rebuilding the index would be required to truly remove it from HNSWLib.
    // For now, we will leave the vectors there or we could rebuild the entire store from files.
    
    try {
        const filePath = path.join(UPLOADS_DIR, name);
        await fs.unlink(filePath).catch(() => {});
    } catch (e) {}
    
    return { success: true };
}

export async function queryVectorStore(query, k = 4) {
    if (!vectorStore) return [];
    try {
        const results = await vectorStore.similaritySearch(query, k);
        return results;
    } catch (e) {
        console.error("Error querying vector store:", e);
        return [];
    }
}
