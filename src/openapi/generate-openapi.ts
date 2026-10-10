import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { applyOpenapiPlaceholderEnv } from './openapi-placeholder-env';
import { generatePluginMetadata } from './plugin-metadata';

const API_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT = path.resolve(
  API_ROOT,
  '..',
  'inexci-frontend',
  'openapi',
  'openapi.json',
);

export async function buildOpenapiDocument(): Promise<OpenAPIObject> {
  const loadMetadata = await generatePluginMetadata(API_ROOT);
  applyOpenapiPlaceholderEnv();
  const originalCwd = process.cwd();
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'inexci-openapi-cwd-')));
  try {
    const [{ AppModule }, { createSwaggerDocument }] = await Promise.all([
      import('../app.module'),
      import('../shared/bootstrap/swagger-config'),
    ]);
    await SwaggerModule.loadPluginMetadata(loadMetadata);
    const app = await NestFactory.create(AppModule, {
      preview: true,
      logger: false,
      abortOnError: false,
    });
    try {
      return createSwaggerDocument(app);
    } finally {
      await app.close();
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? DEFAULT_OUTPUT);
  const document = await buildOpenapiDocument();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  const schemas = Object.keys(document.components?.schemas ?? {}).length;
  console.log(
    `openapi.json gerado em ${output} (${Object.keys(document.paths).length} paths, ${schemas} schemas)`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
