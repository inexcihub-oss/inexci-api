import { PartialType } from '@nestjs/swagger';
import { CreateHealthPlanDto } from './create-health-plan.dto';

export class UpdateHealthPlanDto extends PartialType(CreateHealthPlanDto) {}
