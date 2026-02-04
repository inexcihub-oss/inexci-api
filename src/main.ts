import * as dayjs from 'dayjs';
import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as customParse from 'dayjs/plugin/customParseFormat';
import dataSource from './database/typeorm/data-source';

dayjs.extend(customParse);

async function bootstrap() {
  // Executar migrations automaticamente
  try {
    await dataSource.initialize();
    console.log('🔄 Executando migrations...');
    const migrations = await dataSource.runMigrations();
    if (migrations.length > 0) {
      console.log(
        `✅ ${migrations.length} migration(s) executada(s) com sucesso:`,
      );
      migrations.forEach((migration) => {
        console.log(`   - ${migration.name}`);
      });
    } else {
      console.log('✅ Banco de dados já está atualizado');
    }
    await dataSource.destroy();
  } catch (error) {
    console.error('❌ Erro ao executar migrations:', error.message);
    process.exit(1);
  }

  // NOTA: Para executar seeds, use manualmente: npm run seed
  // Não executamos automaticamente para evitar duplicações em hot reload

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  // Configurar JSON para não escapar caracteres Unicode
  app.getHttpAdapter().getInstance().set('json escape', false);
  app.getHttpAdapter().getInstance().set('json replacer', null);
  app.getHttpAdapter().getInstance().set('json spaces', 2);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({ origin: '*' });
  await app.listen(process.env.PORT || 8088);
}
bootstrap();
