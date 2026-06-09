
import { MongoClient } from 'mongodb';

async function clean() {
    const client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    const db = client.db('jpagents');
    const coll = db.collection('sessions');
    
    const doc = await coll.findOne({ _id: 'global_state' });
    if (!doc || !doc.state) {
        console.log('No global_state found');
        await client.close();
        return;
    }
    
    const projects = doc.state.projects || [];
    console.log('Before:', projects.length, 'projects');
    projects.forEach(p => console.log('  -', p.id, p.name));
    
    // Remove 'nombre' and any project with empty name
    const cleaned = projects.filter(p => {
        const name = (p.name || '').toLowerCase();
        if (name === 'nombre' || name === '') {
            console.log(`REMOVING: id=${p.id} name='${p.name}'`);
            return false;
        }
        return true;
    });
    
    if (cleaned.length !== projects.length) {
        doc.state.projects = cleaned;
        await coll.updateOne(
            { _id: 'global_state' },
            { $set: { state: doc.state, updatedAt: new Date() } }
        );
        console.log('After:', cleaned.length, 'projects');
        console.log('SUCCESS: MongoDB cleaned');
    } else {
        console.log('Nothing to clean');
    }
    
    await client.close();
}

clean().catch(e => console.error('ERROR:', e));
