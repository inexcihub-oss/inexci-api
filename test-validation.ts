import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, IsOptional, IsString } from 'class-validator';

class TestDto {
  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  healthPlanId?: string;
}

async function run() {
  const dto = plainToInstance(TestDto, {
    birth_date: '1990-01-01',
    health_plan_id: 'abc',
  });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  console.log('errors:', JSON.stringify(errors, null, 2));
  console.log('object:', dto);
}
run();
