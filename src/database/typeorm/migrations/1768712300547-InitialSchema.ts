import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1768712300547 implements MigrationInterface {
    name = 'InitialSchema1768712300547'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "default_document_clinic" ("id" SERIAL NOT NULL, "clinic_id" integer NOT NULL, "created_by" integer NOT NULL, "key" character varying(50) NOT NULL, "name" character varying(75) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_738aadc95ed598d081944de5474" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "clinic" ("id" SERIAL NOT NULL, "name" character varying(75) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8e97c18debc9c7f7606e311d763" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "document" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "created_by" integer NOT NULL, "key" character varying(50) NOT NULL, "name" character varying(75) NOT NULL, "uri" character varying(255), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e57d3357f83f3cdc0acffc3d777" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "pendency" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "responsible_id" integer NOT NULL, "key" character varying(50) NOT NULL, "created_manually" boolean NOT NULL DEFAULT false, "name" character varying(75) NOT NULL, "description" text, "concluded_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_83cd95fb02ccfcb31952de6a6c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "chat_message" ("id" SERIAL NOT NULL, "chat_id" integer NOT NULL, "sent_by" integer NOT NULL, "read" boolean NOT NULL DEFAULT false, "message" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3cc0d85193aade457d3077dd06b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "chat" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "user_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9d0b2ba74336710fd31154738a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "surgery_request_quotation" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "supplier_id" integer NOT NULL, "proposal_number" character varying(100), "submission_date" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_58dd66b4a864640600199001332" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "recovery_code" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "used" boolean NOT NULL DEFAULT false, "code" character varying(6) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b7f1e23329e93a80e25fd281922" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user" ("id" SERIAL NOT NULL, "clinic_id" integer, "status" smallint NOT NULL, "pv" smallint NOT NULL, "email" character varying(75) NOT NULL, "password" character varying(60), "name" character varying(75) NOT NULL, "phone" character(11), "gender" character(1), "birth_date" date, "document" character varying(14), "company" character varying(100), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "cid" ("id" character varying(75) NOT NULL, "description" character varying(75) NOT NULL, CONSTRAINT "PK_d216ee86eca749b2a30709489f7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "opme_item" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "name" character varying(75) NOT NULL, "brand" character varying(75) NOT NULL, "distributor" character varying(75) NOT NULL, "quantity" integer NOT NULL, "authorized_quantity" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_96002072337f50b8bb8d9b3abd7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "procedure" ("id" SERIAL NOT NULL, "active" boolean NOT NULL, "tuss_code" character varying(100) NOT NULL, "name" character varying(255) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9888785b528492e7539d96e3894" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "surgery_request_procedure" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "procedure_id" integer NOT NULL, "quantity" integer NOT NULL, "authorized_quantity" integer, CONSTRAINT "PK_50aedd75f4cbd2f5c2cc5703b66" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "status_update" ("id" SERIAL NOT NULL, "surgery_request_id" integer NOT NULL, "prev_status" smallint NOT NULL, "new_status" smallint NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c2b5cab69dfc057284f078d918b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "surgery_request" ("id" SERIAL NOT NULL, "doctor_id" integer NOT NULL, "responsible_id" integer NOT NULL, "hospital_id" integer, "patient_id" integer NOT NULL, "status" smallint NOT NULL, "is_indication" boolean NOT NULL, "indication_name" character varying(75), "health_plan_id" integer, "health_plan_registration" character varying(100), "health_plan_type" character varying(100), "cid_id" character varying(75), "diagnosis" text, "medical_report" text, "patient_history" text, "surgery_date" TIMESTAMP, "invoiced_value" numeric(19,2), "received_value" numeric(19,2), "invoiced_date" TIMESTAMP, "received_date" TIMESTAMP, "date_options" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "contest_reason" text, "date_call" TIMESTAMP, "protocol" character varying(75), CONSTRAINT "PK_74103c4c9eeadd61e34491559b7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "default_document_clinic" ADD CONSTRAINT "FK_9fd2dcca5648e74d9b2b79e1214" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "default_document_clinic" ADD CONSTRAINT "FK_257c4764fd51e2548e259e9e37c" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "document" ADD CONSTRAINT "FK_6ed807dd011acbee547ca95e5ac" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "document" ADD CONSTRAINT "FK_d8538de16919357e4cd0351d0bd" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pendency" ADD CONSTRAINT "FK_93870d0a5be1f9b39d57145e558" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pendency" ADD CONSTRAINT "FK_435288a2c5a1baf47e302ea9ad2" FOREIGN KEY ("responsible_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_634db173c52edece8dd88ea3d4c" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_4f402f3a2faa508ec802e1ec547" FOREIGN KEY ("sent_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat" ADD CONSTRAINT "FK_096460b01905e710c18ec0e1be7" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat" ADD CONSTRAINT "FK_15d83eb496fd7bec7368b30dbf3" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request_quotation" ADD CONSTRAINT "FK_c16e2628da64778fcc94054d03c" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request_quotation" ADD CONSTRAINT "FK_75bf89ae1720acf14bd45cf11c6" FOREIGN KEY ("supplier_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recovery_code" ADD CONSTRAINT "FK_f5c95d9ca2047afa670093e2028" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_89ef5c4a4d2f7959c9368610ed2" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "opme_item" ADD CONSTRAINT "FK_01965849109def09d33400fbd9f" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request_procedure" ADD CONSTRAINT "FK_d9c453a21e06a38434e421ebcdc" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request_procedure" ADD CONSTRAINT "FK_5f62cc1131ccead5434ab04ddde" FOREIGN KEY ("procedure_id") REFERENCES "procedure"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "status_update" ADD CONSTRAINT "FK_f8390fe2c05188bbe4961f835b9" FOREIGN KEY ("surgery_request_id") REFERENCES "surgery_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_b7e705594f01025afe9cb04502c" FOREIGN KEY ("doctor_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_54e2de9705608dfbbead2d6e2bb" FOREIGN KEY ("responsible_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_de12bfe1a8a1ee96049ca63584a" FOREIGN KEY ("hospital_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_2ed2c984e7f481aa73869df78ff" FOREIGN KEY ("patient_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_664d5452332765c45ed1a9d2500" FOREIGN KEY ("cid_id") REFERENCES "cid"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "surgery_request" ADD CONSTRAINT "FK_c8004c3c644ad4c6fe1bd54e450" FOREIGN KEY ("health_plan_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_c8004c3c644ad4c6fe1bd54e450"`);
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_664d5452332765c45ed1a9d2500"`);
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_2ed2c984e7f481aa73869df78ff"`);
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_de12bfe1a8a1ee96049ca63584a"`);
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_54e2de9705608dfbbead2d6e2bb"`);
        await queryRunner.query(`ALTER TABLE "surgery_request" DROP CONSTRAINT "FK_b7e705594f01025afe9cb04502c"`);
        await queryRunner.query(`ALTER TABLE "status_update" DROP CONSTRAINT "FK_f8390fe2c05188bbe4961f835b9"`);
        await queryRunner.query(`ALTER TABLE "surgery_request_procedure" DROP CONSTRAINT "FK_5f62cc1131ccead5434ab04ddde"`);
        await queryRunner.query(`ALTER TABLE "surgery_request_procedure" DROP CONSTRAINT "FK_d9c453a21e06a38434e421ebcdc"`);
        await queryRunner.query(`ALTER TABLE "opme_item" DROP CONSTRAINT "FK_01965849109def09d33400fbd9f"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_89ef5c4a4d2f7959c9368610ed2"`);
        await queryRunner.query(`ALTER TABLE "recovery_code" DROP CONSTRAINT "FK_f5c95d9ca2047afa670093e2028"`);
        await queryRunner.query(`ALTER TABLE "surgery_request_quotation" DROP CONSTRAINT "FK_75bf89ae1720acf14bd45cf11c6"`);
        await queryRunner.query(`ALTER TABLE "surgery_request_quotation" DROP CONSTRAINT "FK_c16e2628da64778fcc94054d03c"`);
        await queryRunner.query(`ALTER TABLE "chat" DROP CONSTRAINT "FK_15d83eb496fd7bec7368b30dbf3"`);
        await queryRunner.query(`ALTER TABLE "chat" DROP CONSTRAINT "FK_096460b01905e710c18ec0e1be7"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_4f402f3a2faa508ec802e1ec547"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_634db173c52edece8dd88ea3d4c"`);
        await queryRunner.query(`ALTER TABLE "pendency" DROP CONSTRAINT "FK_435288a2c5a1baf47e302ea9ad2"`);
        await queryRunner.query(`ALTER TABLE "pendency" DROP CONSTRAINT "FK_93870d0a5be1f9b39d57145e558"`);
        await queryRunner.query(`ALTER TABLE "document" DROP CONSTRAINT "FK_d8538de16919357e4cd0351d0bd"`);
        await queryRunner.query(`ALTER TABLE "document" DROP CONSTRAINT "FK_6ed807dd011acbee547ca95e5ac"`);
        await queryRunner.query(`ALTER TABLE "default_document_clinic" DROP CONSTRAINT "FK_257c4764fd51e2548e259e9e37c"`);
        await queryRunner.query(`ALTER TABLE "default_document_clinic" DROP CONSTRAINT "FK_9fd2dcca5648e74d9b2b79e1214"`);
        await queryRunner.query(`DROP TABLE "surgery_request"`);
        await queryRunner.query(`DROP TABLE "status_update"`);
        await queryRunner.query(`DROP TABLE "surgery_request_procedure"`);
        await queryRunner.query(`DROP TABLE "procedure"`);
        await queryRunner.query(`DROP TABLE "opme_item"`);
        await queryRunner.query(`DROP TABLE "cid"`);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP TABLE "recovery_code"`);
        await queryRunner.query(`DROP TABLE "surgery_request_quotation"`);
        await queryRunner.query(`DROP TABLE "chat"`);
        await queryRunner.query(`DROP TABLE "chat_message"`);
        await queryRunner.query(`DROP TABLE "pendency"`);
        await queryRunner.query(`DROP TABLE "document"`);
        await queryRunner.query(`DROP TABLE "clinic"`);
        await queryRunner.query(`DROP TABLE "default_document_clinic"`);
    }

}
