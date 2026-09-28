import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
async function main(){const db=await PGlite.create(process.env.PGLITE_DATA||'.data/pglite');const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:55432,maxConnections:20});await server.start();console.log('PGLITE_READY 55432 (development only)');const stop=async()=>{await server.stop();await db.close();process.exit()};process.on('SIGTERM',stop);process.on('SIGINT',stop);}main();
