import { Type } from "class-transformer";
import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class DeleteDocumentDto {
    @IsNumber()
    @Type(() => Number)
    @IsNotEmpty()
    id: number;
    
    @IsString()
    @IsNotEmpty()
    key: string;

    @IsNumber()
    @Type(() => Number)
    @IsNotEmpty()
    surgery_request_id: number;
    
}