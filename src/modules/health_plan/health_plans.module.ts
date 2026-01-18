import { Module } from "@nestjs/common";
import { HealthPlansController } from "./health_plans.controller";
import { HealthPlansService } from "./health_plans_service";
import { UserRepository } from "src/database/repositories/user.repository";
import { AuthModule } from "../auth/auth.module";

@Module({
    imports: [AuthModule],
    controllers: [HealthPlansController],
    providers: [HealthPlansService, UserRepository],
})
export class HealthPlansModule {}