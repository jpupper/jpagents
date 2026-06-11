import { MongoClient } from 'mongodb';

const uri = 'mongodb://localhost:27017';
const dbName = 'jpagents';

let client;
let db;

export async function connectDB() {
    if (db) return db;
    try {
        client = new MongoClient(uri);
        await client.connect();
        console.log('✅ Conectado a MongoDB (Local)');
        db = client.db(dbName);
        
        // Ensure indexes
        await db.collection('sessions').createIndex({ id: 1 }, { unique: true });
        
        return db;
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        throw error;
    }
}

export function getCollection(name) {
    if (!db) {
        console.error('[DB] Base de datos no conectada — usando almacenamiento en memoria.');
        return createMemoryFallback(name);
    }
    return db.collection(name);
}

// Fallback in-memory when MongoDB is down — keeps the server alive
const memoryStores = {};
function createMemoryFallback(name) {
    if (!memoryStores[name]) {
        const store = [];
        memoryStores[name] = {
            find: (query = {}) => ({
                sort: () => ({
                    limit: () => ({
                        toArray: async () => {
                            let results = [...store];
                            // Simple filter support
                            if (query._id && query._id.$ne) {
                                results = results.filter(r => r._id !== query._id.$ne);
                            }
                            return results;
                        }
                    }),
                    toArray: async () => [...store]
                })
            }),
            findOne: async (query) => {
                if (query._id === 'global_state') {
                    const found = store.find(r => r._id === 'global_state');
                    return found || null;
                }
                return store.find(r => Object.keys(query).every(k => r[k] === query[k])) || null;
            },
            insertOne: async (doc) => {
                if (!doc._id) doc._id = Math.random().toString(36).substr(2);
                store.push(doc);
                return { insertedId: doc._id };
            },
            updateOne: async (filter, update, opts = {}) => {
                const existing = store.findIndex(r => Object.keys(filter).every(k => r[k] === filter[k]));
                const now = new Date();
                if (existing >= 0) {
                    Object.assign(store[existing], update.$set || {}, { updatedAt: now });
                } else if (opts.upsert) {
                    store.push({ ...filter, ...(update.$set || {}), updatedAt: now });
                }
            },
            deleteOne: async (filter) => {
                const idx = store.findIndex(r => Object.keys(filter).every(k => r[k] === filter[k]));
                if (idx >= 0) store.splice(idx, 1);
            },
            deleteMany: async (filter = {}) => {
                if (Object.keys(filter).length === 0) {
                    store.length = 0;
                } else {
                    // Remove matching items
                    let i = store.length;
                    while (i--) {
                        if (Object.keys(filter).every(k => store[i][k] === filter[k])) {
                            store.splice(i, 1);
                        }
                    }
                }
            },
            countDocuments: async (query = {}) => {
                if (Object.keys(query).length === 0) return store.length;
                return store.filter(r => Object.keys(query).every(k => r[k] === query[k])).length;
            },
            createIndex: async () => {}
        };
    }
    return memoryStores[name];
}
