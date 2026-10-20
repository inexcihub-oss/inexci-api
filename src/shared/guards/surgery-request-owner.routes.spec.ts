import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SKIP_SURGERY_OWNER } from './surgery-request-owner.guard';
import { SurgeryRequestsController } from 'src/modules/surgery-requests/surgery-requests.controller';
import { PendenciesController } from 'src/modules/surgery-requests/pendencies/pendencies.controller';
import { ActivitiesController } from 'src/modules/surgery-requests/activities/activities.controller';
import { DocumentsController } from 'src/modules/surgery-requests/documents/documents.controller';

type Controlador = new (...args: never[]) => object;

function rotasSemIdNaUrl(controller: Controlador): string[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((nome) => nome !== 'constructor')
    .map((nome) => proto[nome])
    .filter(
      (handler): handler is object =>
        typeof handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined,
    )
    .filter((handler) => !Reflect.getMetadata(SKIP_SURGERY_OWNER, handler))
    .map((handler) => {
      const caminho = `${base}/${String(Reflect.getMetadata(PATH_METADATA, handler))}`;
      const metodo =
        RequestMethod[
          Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
        ];
      return `${metodo} ${caminho.replace(/\/+$/, '').replace(/\/+/g, '/')}`;
    })
    .filter((rota) => !/:(id|surgeryRequestId)\b/.test(rota));
}

describe('rotas protegidas pelo SurgeryRequestOwnerGuard', () => {
  it('toda rota sem id na URL está mapeada: id em query/corpo, multipart ou @SkipSurgeryOwner', () => {
    const rotas = [
      SurgeryRequestsController,
      PendenciesController,
      ActivitiesController,
      DocumentsController,
    ]
      .flatMap((c) => rotasSemIdNaUrl(c as unknown as Controlador))
      .sort();

    expect(rotas).toEqual(
      [
        'DELETE surgery-requests/documents',
        'GET surgery-requests/one',
        'POST surgery-requests/documents',
        'POST surgery-requests/extract-from-document',
        'PUT surgery-requests',
      ].sort(),
    );
  });
});
