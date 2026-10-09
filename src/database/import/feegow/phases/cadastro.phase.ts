import { EntityManager } from 'typeorm';
import { Clinic } from 'src/database/entities/clinic.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { User } from 'src/database/entities/user.entity';
import { UserDoctorAccess } from 'src/database/entities/user-doctor-access.entity';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import { NovaClinica, planejarClinica } from '../mappers/clinic.mapper';
import { NovoConvenio, planejarConvenios } from '../mappers/health-plan.mapper';
import { NovoPaciente, planejarPacientes } from '../mappers/patient.mapper';
import { PlanoEquipe, planejarEquipe } from '../mappers/team.mapper';
import { inserirEmLotes } from './inserir-em-lotes';

export interface PlanoCadastro {
  clinica: NovaClinica | null;
  equipe: PlanoEquipe;
  convenios: NovoConvenio[];
  pacientes: NovoPaciente[];
}

export function planejarCadastro(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): PlanoCadastro {
  const clinica = planejarClinica(exp, ctx);
  const equipe = planejarEquipe(exp, ctx);
  const convenios = planejarConvenios(exp, ctx);
  const pacientes = planejarPacientes(exp, ctx);
  return { clinica, equipe, convenios, pacientes };
}

export async function gravarCadastro(
  plano: PlanoCadastro,
  manager: EntityManager,
): Promise<void> {
  if (plano.clinica) await inserirEmLotes(manager, Clinic, [plano.clinica]);
  await inserirEmLotes(manager, User, plano.equipe.usuarios);
  await inserirEmLotes(manager, DoctorProfile, plano.equipe.perfis);
  await inserirEmLotes(manager, UserDoctorAccess, plano.equipe.acessos, true);
  await inserirEmLotes(manager, HealthPlan, plano.convenios);
  await inserirEmLotes(manager, Patient, plano.pacientes);
}
