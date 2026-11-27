# Migración Cloudflare

Esta carpeta es la base de la migración, no un servidor multijugador listo para producción.

## Recursos previstos
- Workers: API y entrega de la aplicación web.
- D1: perfiles, WINS y clasificación.
- Durable Objects: salas y conexiones WebSocket.

## Estado
- [x] Configuración inicial de Wrangler.
- [x] Esquema D1 para jugadores, victorias e índices.
- [x] Endpoints de salud, perfil y clasificación.
- [ ] Migrar autenticación segura al Worker.
- [ ] Migrar el protocolo de salas y WebSockets a Durable Objects.
- [ ] Migrar el motor de similitud semántica y sus datos de vocabulario.
- [ ] Probar partidas reales desde dos redes/dispositivos.

El cliente actual todavía conecta WebSocket a la raíz del servidor. El Worker devuelve 503 deliberadamente para evitar aparentar que el multijugador funciona antes de terminar la migración. No publiques este Worker como sustituto del servidor actual hasta completar los puntos pendientes.

## Preparación local
1. Instala Wrangler: `npm install -D wrangler`.
2. Crea la base D1 `grena-contexto` y sustituye el identificador en `wrangler.toml`.
3. Aplica el esquema: `npx wrangler d1 migrations apply grena-contexto --remote`.
4. Despliega solo cuando el protocolo WebSocket y el motor semántico estén implementados y probados.
