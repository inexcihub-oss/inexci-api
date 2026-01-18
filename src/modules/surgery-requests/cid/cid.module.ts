import { Module } from "@nestjs/common";
import { CidController } from "./cid.controller";
import { CidService } from "./cid.service";
import { CidRepository } from "src/database/repositories/cid.repository";

@Module({
    controllers: [CidController],
    providers: [CidService, CidRepository],
    exports: [CidService],
})
export class CidModule {}