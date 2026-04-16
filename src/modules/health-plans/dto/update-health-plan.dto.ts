import { PartialType } from '@nestjs/mapped-types';
import { CreateHealthPlanDto } from './create-health-plan.dto';

export class UpdateHealthPlanDto extends PartialType(CreateHealthPlanDto) {}
