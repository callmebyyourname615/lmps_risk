import { createApp } from './app.js';

async function main() {
  const { app, config } = await createApp();
  try {
    app.enableShutdownHooks();
    await app.listen(config.port, '127.0.0.1');
    console.info(`Risk API bootstrap: http://127.0.0.1:${config.port}/docs`);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Risk API startup failed.');
  process.exitCode = 1;
});
