import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { OnboardingController } from './onboarding.controller';

describe('Permissões declaradas no OnboardingController', () => {
  const reflector = new Reflector();

  it('usa o opt-out (array vazio) no controller inteiro', () => {
    expect(reflector.get(PERMISSIONS_KEY, OnboardingController)).toEqual([]);
  });
});
