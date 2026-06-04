import { MongoClient } from 'mongodb';

const uri = 'mongodb://localhost:27017';
const client = new MongoClient(uri);
await client.connect();
const db = client.db('jpagents');
const col = db.collection('sessions');

const existing = await col.findOne({ _id: 'global_state' });
if (!existing) {
    console.log('No global_state found!');
    await client.close();
    process.exit(1);
}

// Check if already exists
const already = existing.state.projects.find(p => p.name === 'Efecto Particulas Violetas');
if (already) {
    console.log('✅ Project already exists in MongoDB:', already.id);
    console.log('Agent ID:', already.chats?.[0]?.id);
    await client.close();
    process.exit(0);
}

const pid = 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const aid = 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);

existing.state.projects.push({
    id: pid,
    name: 'Efecto Particulas Violetas',
    folder: 'D:\\Programacion\\jpagents\\proyects\\violet_particles',
    model: 'deepseek-v4-pro',
    chats: [{
        id: aid,
        name: 'Violet Particle Dev',
        messages: [],
        isThinking: false,
        isRunning: false,
        isStopped: false,
        mode: 'auto',
        lastProgress: Date.now(),
        model: 'deepseek-v4-pro',
        useHermes: true
    }],
    openFiles: [],
    sessionChanges: [],
    activeTabId: 'matrix',
    currentFiles: [],
    projectPrompt: '',
    isCorrupted: false,
    isInitialName: true
});

await col.updateOne({ _id: 'global_state' }, { $set: { state: existing.state } });
console.log('✅ Project created in MongoDB!');
console.log('Project ID:', pid);
console.log('Agent ID:', aid);
await client.close();
