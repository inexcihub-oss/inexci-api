import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelTierConfigService } from './model-tier.config';
import { ModelGatewayService } from './model-gateway.service';
import { OpenaiService } from '../services/openai.service';

/**
 * Módulo do Model Gateway (Fase 1 do Blueprint v3). Empacota o
 * resolvedor de tiers e a fachada `ModelGatewayService`. Importável
 * por outros módulos sem precisar reexpor `OpenaiService`.
 *
 * Mantém `OpenaiService` como provider interno enquanto o restante do
 * código ainda chama-o diretamente — Fase 2+ migra chamadores um a um
 * para o gateway.
 */
@Module({
  imports: [ConfigModule],
  providers: [ModelTierConfigService, OpenaiService, ModelGatewayService],
  exports: [ModelTierConfigService, ModelGatewayService, OpenaiService],
})
export class ModelGatewayModule {}
