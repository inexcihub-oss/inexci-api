import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateDocumentKeyDto {
    @IsString()
    @IsNotEmpty()
    key: string;
    name: string;
}
