import { buildLaudoPatientFields } from './laudo-patient-fields.util';

describe('buildLaudoPatientFields', () => {
  it('monta campos do paciente a partir da entidade patient', () => {
    const result = buildLaudoPatientFields({
      patient: {
        name: 'Maria Silva',
        birthDate: '1990-05-10',
        rg: '1234567',
        cpf: '12345678901',
        phone: '11999998888',
        address: 'Rua A, 10',
        zipCode: '01310100',
      },
      healthPlan: { name: 'Unimed' },
    });

    expect(result).toEqual({
      patientName: 'Maria Silva',
      patientBirthDate: '10/05/1990',
      patientRg: '1234567',
      patientCpf: '123.456.789-01',
      patientPhone: '(11) 99999-8888',
      patientAddress: 'Rua A, 10',
      patientZipCode: '01310-100',
      patientHealthPlan: 'Unimed',
    });
  });

  it('retorna apenas campos preenchidos', () => {
    const result = buildLaudoPatientFields({
      patient: {
        name: 'Patrícia Gonçalves Ferraz',
        cpf: '',
        phone: '1199',
      },
      healthPlan: { name: '  ' },
    });

    expect(result).toEqual({
      patientName: 'Patrícia Gonçalves Ferraz',
    });
  });

  it('omite cpf parcial ou inválido', () => {
    const result = buildLaudoPatientFields({
      patient: {
        name: 'João',
        cpf: '123456',
      },
    });

    expect(result).toEqual({
      patientName: 'João',
    });
  });

  it('inclui número da carteirinha do paciente ou matrícula da SC', () => {
    expect(
      buildLaudoPatientFields({
        patient: {
          name: 'Patrícia Gonçalves Ferraz',
          healthPlanNumber: '7766554433',
        },
        healthPlan: { name: 'Unimed Paulistana' },
      }),
    ).toEqual({
      patientName: 'Patrícia Gonçalves Ferraz',
      patientHealthPlan: 'Unimed Paulistana',
      patientHealthPlanNumber: '7766554433',
    });

    expect(
      buildLaudoPatientFields({
        patient: { name: 'Patrícia Gonçalves Ferraz' },
        healthPlan: { name: 'Unimed Paulistana' },
        healthPlanRegistration: '7766554433',
      }),
    ).toEqual({
      patientName: 'Patrícia Gonçalves Ferraz',
      patientHealthPlan: 'Unimed Paulistana',
      patientHealthPlanNumber: '7766554433',
    });
  });

  it('monta endereço completo a partir dos componentes do paciente', () => {
    const result = buildLaudoPatientFields({
      patient: {
        name: 'Patrícia Gonçalves Ferraz',
        address: 'Av. Paulista',
        addressNumber: '900',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
    });

    expect(result.patientAddress).toBe(
      'Av. Paulista, 900, Bela Vista, São Paulo, SP',
    );
  });
});
