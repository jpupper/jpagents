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
    if (!db) throw new Error('Base de datos no conectada');
    return db.collection(name);
}
