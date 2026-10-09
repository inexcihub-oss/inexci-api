import { PATH_METADATA } from '@nestjs/common/constants';
import { ActivitiesController } from './activities.controller';

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
