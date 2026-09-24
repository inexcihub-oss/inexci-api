import { PATH_METADATA } from '@nestjs/common/constants';
import { ActivitiesController } from './activities.controller';

/**
 * Caminho completo das rotas do controller, como o Nest as registra.
 *
 * O cliente HTTP do frontend monta essas URLs à mão
 * (`inexci-frontend/services/surgery-request.service.ts`). Um segmento a menos
 * não quebra o build nem o tipo: vira 404 em runtime, e a tela que engole o
 * erro só mostra uma lista vazia. Foi exatamente o que aconteceu com
 * `mentionable-users`, chamado sem o `/activities` — o dropdown de @ nunca
 * abria e não havia teste que percebesse. Este spec fixa o contrato do lado
 * do servidor; o do cliente está em
 * `inexci-frontend/services/surgery-request-mentions.spec.ts`.
 */
function caminhoDaRota(metodo: keyof ActivitiesController): string {
  const prefixo = Reflect.getMetadata(
    PATH_METADATA,
    ActivitiesController,
  ) as string;
  const sufixo = Reflect.getMetadata(
    PATH_METADATA,
    ActivitiesController.prototype[metodo],
  ) as string;

  return `/${prefixo}/${sufixo}`.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
}

describe('ActivitiesController — rotas registradas', () => {
  it('expõe os usuários mencionáveis sob o caminho de atividades', () => {
    expect(caminhoDaRota('findMentionableUsers')).toBe(
      '/surgery-requests/:id/activities/mentionable-users',
    );
  });

  it('expõe a listagem e a criação na raiz de atividades', () => {
    expect(caminhoDaRota('findAll')).toBe('/surgery-requests/:id/activities');
    expect(caminhoDaRota('create')).toBe('/surgery-requests/:id/activities');
  });
});
