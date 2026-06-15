import { getRealtimeVersion } from './_lib/realtime.js';

export async function onRequestGet(context){
  const encoder = new TextEncoder();
  let closed = false;
  context.request.signal?.addEventListener('abort', ()=>{ closed = true; });
  const stream = new ReadableStream({
    async start(controller){
      let last = '';
      const startedAt = Date.now();
      while(!closed && Date.now() - startedAt < 55_000){
        try{
          const version = await getRealtimeVersion();
          if(version !== last){
            last = version;
            controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify({ version })}\n\n`));
          }else{
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
          }
        }catch(error){
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message:'实时连接暂时不可用' })}\n\n`));
        }
        await new Promise(resolve=>setTimeout(resolve, 1200));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    headers:{
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    }
  });
}

export function onRequest(){
  return new Response(JSON.stringify({ error:'只支持 GET 请求。' }), {
    status:405,
    headers:{ 'Content-Type':'application/json; charset=utf-8' }
  });
}
