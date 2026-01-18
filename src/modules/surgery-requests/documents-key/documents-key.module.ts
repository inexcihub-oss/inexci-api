import { Module } from "@nestjs/common";
import { DocumentsKeyService } from "./documents-key.service";
import { DocumentsKeyController } from "./documents-key.controller";
import { DocumentKeyRepository } from "src/database/repositories/document-key.repository";
import { UserRepository } from "src/database/repositories/user.repository";

@Module({
    controllers: [DocumentsKeyController],
    providers: [DocumentsKeyService, DocumentKeyRepository, UserRepository],
    exports: [DocumentsKeyService]
})
export class DocumentsKeyModule {}