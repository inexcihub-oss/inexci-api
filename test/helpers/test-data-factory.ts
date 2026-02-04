import { faker } from '@faker-js/faker';

// Constantes de UserRole (espelhando src/database/entities/user.entity.ts)
const UserRole = {
  admin: 'admin',
  doctor: 'doctor',
  collaborator: 'collaborator',
};

// Constantes de UserStatuses
const UserStatuses = {
  pending: 1,
  active: 2,
  inactive: 3,
};

export class TestDataFactory {
  // Dados para registro (compatível com RegisterDto)
  static generateRegisterData() {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      password: 'Test@1234',
    };
  }

  // Dados para criar usuário via API (compatível com CreateUserDto)
  static generateCreateUserData() {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      phone: this.generatePhone(),
      role: faker.helpers.arrayElement([
        UserRole.doctor,
        UserRole.collaborator,
      ]),
    };
  }

  // Dados completos de usuário (para uso interno/legado)
  static generateUser() {
    return {
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      password: 'Test@1234',
      cpf: this.generateCPF(),
      phone: this.generatePhone(),
      role: UserRole.doctor,
    };
  }

  static generatePatient() {
    return {
      name: faker.person.fullName(),
      cpf: this.generateCPF(),
      rg: faker.string.numeric(9),
      birthDate: faker.date.past({ years: 50 }).toISOString().split('T')[0],
      phone: this.generatePhone(),
      email: faker.internet.email(),
      address: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      zipCode: faker.string.numeric(8),
    };
  }

  static generateHospital() {
    return {
      name: faker.company.name(),
      cnpj: this.generateCNPJ(),
      address: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      zipCode: faker.string.numeric(8),
      phone: this.generatePhone(),
      email: faker.internet.email(),
    };
  }

  static generateHealthPlan() {
    return {
      name: faker.company.name(),
      cnpj: this.generateCNPJ(),
      phone: this.generatePhone(),
      email: faker.internet.email(),
      address: faker.location.streetAddress(),
    };
  }

  static generateSupplier() {
    return {
      name: faker.company.name(),
      cnpj: this.generateCNPJ(),
      phone: this.generatePhone(),
      email: faker.internet.email(),
      address: faker.location.streetAddress(),
    };
  }

  static generateProcedure() {
    return {
      name: faker.helpers.arrayElement([
        'Cirurgia de Catarata',
        'Cirurgia de Hérnia',
        'Cirurgia de Vesícula',
        'Cirurgia de Apendicite',
        'Cirurgia Ortopédica',
      ]),
      code: faker.string.alphanumeric(8).toUpperCase(),
      description: faker.lorem.sentence(),
    };
  }

  static generateSurgeryRequest(
    patientId: number,
    hospitalId: number,
    healthPlanId: number,
  ) {
    return {
      patient_id: patientId,
      hospital_id: hospitalId,
      health_plan_id: healthPlanId,
      surgery_date: faker.date.future().toISOString().split('T')[0],
      observation: faker.lorem.paragraph(),
    };
  }

  // Gera dados mínimos para criar solicitação de cirurgia (para testes)
  static generateSurgeryRequestData() {
    return {
      is_indication: false,
      indication_name: '',
      patient: {
        name: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        phone: this.generatePhone(),
      },
      collaborator: {
        status: UserStatuses.active,
        name: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        phone: this.generatePhone(),
        password: 'Test@1234',
      },
      health_plan: {
        name: faker.company.name(),
        email: faker.internet.email().toLowerCase(),
        phone: this.generatePhone(),
      },
    };
  }

  static generateQuotation(surgeryRequestId: number, supplierId: number) {
    return {
      surgery_request_id: surgeryRequestId,
      supplier_id: supplierId,
      amount: parseFloat(faker.commerce.price({ min: 1000, max: 10000 })),
      items: [
        {
          name: faker.commerce.productName(),
          quantity: faker.number.int({ min: 1, max: 10 }),
          unitPrice: parseFloat(faker.commerce.price({ min: 100, max: 1000 })),
        },
      ],
    };
  }

  private static generateCPF(): string {
    // Gera CPF válido
    const randomDigits = () => Math.floor(Math.random() * 9);
    const cpf = Array.from({ length: 9 }, randomDigits);

    // Calcula primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += cpf[i] * (10 - i);
    }
    cpf.push(((sum * 10) % 11) % 10);

    // Calcula segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += cpf[i] * (11 - i);
    }
    cpf.push(((sum * 10) % 11) % 10);

    return cpf.join('');
  }

  private static generateCNPJ(): string {
    // Gera CNPJ válido
    const randomDigits = () => Math.floor(Math.random() * 9);
    const cnpj = Array.from({ length: 12 }, randomDigits);

    // Calcula primeiro dígito verificador
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += cnpj[i] * weights1[i];
    }
    cnpj.push(sum % 11 < 2 ? 0 : 11 - (sum % 11));

    // Calcula segundo dígito verificador
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    sum = 0;
    for (let i = 0; i < 13; i++) {
      sum += cnpj[i] * weights2[i];
    }
    cnpj.push(sum % 11 < 2 ? 0 : 11 - (sum % 11));

    return cnpj.join('');
  }

  private static generatePhone(): string {
    return `11${faker.string.numeric(9)}`;
  }
}
