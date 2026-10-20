import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import {
  PluginMetadataGenerateOptions,
  PluginMetadataGenerator,
} from '@nestjs/cli/lib/compiler/plugins/plugin-metadata-generator';
import { ReadonlyVisitor } from '@nestjs/swagger/dist/plugin';
import { pluginDebugLogger } from '@nestjs/swagger/dist/plugin/plugin-debug-logger';

const NEST_CLI_FILE = 'nest-cli.json';
const SWAGGER_PLUGIN = '@nestjs/swagger';
const METADATA_FILENAME = 'openapi-metadata.ts';

export type PluginMetadataLoader = () => Promise<Record<string, unknown>>;

interface NestCliPlugin {
  name: string;
  options?: Record<string, unknown>;
}

interface NestCliConfig {
  compilerOptions?: { plugins?: Array<string | NestCliPlugin> };
}

export function readSwaggerPluginOptions(
  apiRoot: string,
): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(apiRoot, NEST_CLI_FILE), 'utf8');
  const config = JSON.parse(raw) as NestCliConfig;
  const plugin = (config.compilerOptions?.plugins ?? []).find((entry) =>
    typeof entry === 'string'
      ? entry === SWAGGER_PLUGIN
      : entry.name === SWAGGER_PLUGIN,
  );
  if (!plugin) {
    throw new Error(
      `Plugin ${SWAGGER_PLUGIN} não está habilitado em ${NEST_CLI_FILE}: os DTOs sairiam sem propriedades.`,
    );
  }
  return typeof plugin === 'string' ? {} : (plugin.options ?? {});
}

type CliProgram = NonNullable<PluginMetadataGenerateOptions['tsProgramRef']>;

function createProgram(apiRoot: string): CliProgram {
  const configPath = path.join(apiRoot, 'tsconfig.build.json');
  const { config, error } = ts.readConfigFile(configPath, (file) =>
    ts.sys.readFile(file),
  );
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, apiRoot);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    noEmit: true,
    incremental: false,
  });
  return program as unknown as CliProgram;
}

export async function generatePluginMetadata(
  apiRoot: string,
): Promise<PluginMetadataLoader> {
  pluginDebugLogger.setLogLevels(['error']);
  const outputDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'inexci-openapi-')),
  );
  new PluginMetadataGenerator().generate({
    visitors: [
      new ReadonlyVisitor({
        ...readSwaggerPluginOptions(apiRoot),
        pathToSource: outputDir,
      }),
    ],
    outputDir,
    filename: METADATA_FILENAME,
    tsProgramRef: createProgram(apiRoot),
  });
  const metadataModule = (await import(
    path.join(outputDir, METADATA_FILENAME)
  )) as { default: PluginMetadataLoader };
  return metadataModule.default;
}
