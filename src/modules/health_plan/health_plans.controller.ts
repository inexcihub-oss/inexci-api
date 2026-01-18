import { Controller, Get, Query, Request } from "@nestjs/common";
import { HealthPlansService } from "./health_plans_service";
import { FindManyHealthPlanDto } from "./dto/find-many-health-plan.dto";

@Controller('health_plans')
export class HealthPlansController {
    constructor(private readonly healthPlansService: HealthPlansService) {}

    @Get()
    findAll(@Query() query: FindManyHealthPlanDto, @Request() req) {        
        return this.healthPlansService.findAll(query, req.user.userId);
    }
}